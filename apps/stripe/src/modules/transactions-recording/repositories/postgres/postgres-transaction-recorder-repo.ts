import { findInstallationId } from "@saleor/postgres-persistence";
import { err, ok } from "neverthrow";
import type { Pool } from "pg";

import { createResolvedTransactionFlow } from "@/modules/resolved-transaction-flow";
import { createSaleorTransactionFlow } from "@/modules/saleor/saleor-transaction-flow";
import { createSaleorTransactionId } from "@/modules/saleor/saleor-transaction-id";
import { type PaymentMethod } from "@/modules/stripe/payment-methods/types";
import {
  createStripePaymentIntentId,
  type StripePaymentIntentId,
} from "@/modules/stripe/stripe-payment-intent-id";
import { RecordedTransaction } from "@/modules/transactions-recording/domain/recorded-transaction";
import {
  TransactionRecorderError,
  type TransactionRecorderRepo,
  type TransactionRecorderRepoAccess,
} from "@/modules/transactions-recording/repositories/transaction-recorder-repo";

type TransactionRow = {
  payment_intent_id: string;
  saleor_transaction_id: string;
  requested_flow: string;
  resolved_flow: string;
  payment_method: PaymentMethod["type"];
  saleor_schema_major: number;
  saleor_schema_minor: number;
};

type TransactionStatusRow = {
  last_event_at: Date | null;
};

export class PostgresTransactionRecorderRepo implements TransactionRecorderRepo {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async recordTransaction(access: TransactionRecorderRepoAccess, transaction: RecordedTransaction) {
    try {
      const installationId = await this.requireInstallation(access);
      const [major, minor] = transaction.saleorSchemaVersion;
      const result = await this.pool.query<TransactionRow>(
        `INSERT INTO stripe.recorded_transactions
           (installation_id, payment_intent_id, saleor_transaction_id, requested_flow,
            resolved_flow, payment_method, saleor_schema_major, saleor_schema_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING
         RETURNING payment_intent_id, saleor_transaction_id, requested_flow, resolved_flow,
                   payment_method, saleor_schema_major, saleor_schema_minor`,
        [
          installationId,
          transaction.stripePaymentIntentId,
          transaction.saleorTransactionId,
          transaction.saleorTransactionFlow,
          transaction.resolvedTransactionFlow,
          transaction.selectedPaymentMethod,
          major,
          minor,
        ],
      );

      if (result.rowCount === 1) return ok(null);
      const existing = await this.pool.query<TransactionRow>(
        `SELECT payment_intent_id, saleor_transaction_id, requested_flow, resolved_flow,
                payment_method, saleor_schema_major, saleor_schema_minor
           FROM stripe.recorded_transactions
          WHERE installation_id = $1
            AND (payment_intent_id = $2 OR saleor_transaction_id = $3)`,
        [installationId, transaction.stripePaymentIntentId, transaction.saleorTransactionId],
      );
      const identical = existing.rows.length === 1 && this.identical(existing.rows[0], transaction);

      if (identical) return ok(null);
      throw new Error("Conflicting Stripe PaymentIntent/Saleor transaction mapping");
    } catch (error) {
      return err(
        new TransactionRecorderError.FailedWritingTransactionError(
          "Failed to write transaction to PostgreSQL",
          { cause: error },
        ),
      );
    }
  }

  async getTransactionByStripePaymentIntentId(
    access: TransactionRecorderRepoAccess,
    id: StripePaymentIntentId,
  ) {
    try {
      const installationId = await this.requireInstallation(access);
      const result = await this.pool.query<TransactionRow>(
        `SELECT payment_intent_id, saleor_transaction_id, requested_flow, resolved_flow,
                payment_method, saleor_schema_major, saleor_schema_minor
           FROM stripe.recorded_transactions
          WHERE installation_id = $1 AND payment_intent_id = $2`,
        [installationId, id],
      );
      const row = result.rows[0];

      if (!row)
        return err(
          new TransactionRecorderError.TransactionMissingError(
            "Transaction not found in PostgreSQL",
            { props: { paymentIntentId: id } },
          ),
        );

      return ok(
        new RecordedTransaction({
          resolvedTransactionFlow: createResolvedTransactionFlow(row.resolved_flow),
          saleorTransactionFlow: createSaleorTransactionFlow(row.requested_flow),
          saleorTransactionId: createSaleorTransactionId(row.saleor_transaction_id),
          stripePaymentIntentId: createStripePaymentIntentId(row.payment_intent_id),
          selectedPaymentMethod: row.payment_method,
          saleorSchemaVersion: [row.saleor_schema_major, row.saleor_schema_minor],
        }),
      );
    } catch (error) {
      return err(
        new TransactionRecorderError.FailedFetchingTransactionError(
          "Failed to fetch transaction from PostgreSQL",
          { cause: error },
        ),
      );
    }
  }

  async recordStatus(
    access: TransactionRecorderRepoAccess,
    event: { id: StripePaymentIntentId; status: string; eventAt: Date },
  ) {
    try {
      const installationId = await this.requireInstallation(access);
      const terminal = new Set(["succeeded", "canceled"]);
      const update = await this.pool.query(
        `UPDATE stripe.recorded_transactions
            SET stripe_status = $3, last_event_at = $4,
                terminal_at = CASE WHEN $5 THEN COALESCE(terminal_at, $4) ELSE terminal_at END,
                updated_at = now()
          WHERE installation_id = $1 AND payment_intent_id = $2
            AND (last_event_at IS NULL OR last_event_at <= $4)`,
        [installationId, event.id, event.status, event.eventAt, terminal.has(event.status)],
      );

      if (update.rowCount === 1) return ok("updated" as const);

      const existing = await this.pool.query<TransactionStatusRow>(
        `SELECT last_event_at
           FROM stripe.recorded_transactions
          WHERE installation_id = $1 AND payment_intent_id = $2`,
        [installationId, event.id],
      );

      if (existing.rowCount === 1) return ok("stale" as const);

      return err(
        new TransactionRecorderError.TransactionMissingError(
          "Stripe status arrived without a recorded transaction mapping",
          { props: { paymentIntentId: event.id } },
        ),
      );
    } catch (error) {
      return err(
        new TransactionRecorderError.FailedWritingTransactionError(
          "Failed to update Stripe transaction status in PostgreSQL",
          { cause: error },
        ),
      );
    }
  }

  private identical(row: TransactionRow, transaction: RecordedTransaction) {
    const [major, minor] = transaction.saleorSchemaVersion;

    return (
      row.payment_intent_id === transaction.stripePaymentIntentId &&
      row.saleor_transaction_id === transaction.saleorTransactionId &&
      row.requested_flow === transaction.saleorTransactionFlow &&
      row.resolved_flow === transaction.resolvedTransactionFlow &&
      row.payment_method === transaction.selectedPaymentMethod &&
      row.saleor_schema_major === major &&
      row.saleor_schema_minor === minor
    );
  }

  private async requireInstallation(access: TransactionRecorderRepoAccess) {
    const installationId = await findInstallationId(this.pool, "stripe", access);

    if (!installationId) throw new Error("Active Stripe installation not found");

    return installationId;
  }
}
