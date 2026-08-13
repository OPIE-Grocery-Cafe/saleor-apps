import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  mockedSaleorAppId,
  mockedSaleorSchemaVersionSupportingPaymentMethodDetails,
  mockedSaleorTransactionId,
} from "@/__tests__/mocks/constants";
import { mockedSaleorApiUrl } from "@/__tests__/mocks/saleor-api-url";
import { createResolvedTransactionFlow } from "@/modules/resolved-transaction-flow";
import { createSaleorTransactionFlow } from "@/modules/saleor/saleor-transaction-flow";
import { createStripePaymentIntentId } from "@/modules/stripe/stripe-payment-intent-id";
import { RecordedTransaction } from "@/modules/transactions-recording/domain/recorded-transaction";
import { TransactionRecorderError } from "@/modules/transactions-recording/repositories/transaction-recorder-repo";

import { PostgresTransactionRecorderRepo } from "./postgres-transaction-recorder-repo";

const access = { appId: mockedSaleorAppId, saleorApiUrl: mockedSaleorApiUrl };
const transaction = new RecordedTransaction({
  saleorTransactionId: mockedSaleorTransactionId,
  stripePaymentIntentId: createStripePaymentIntentId("pi_123"),
  saleorTransactionFlow: createSaleorTransactionFlow("AUTHORIZATION"),
  resolvedTransactionFlow: createResolvedTransactionFlow("AUTHORIZATION"),
  selectedPaymentMethod: "card",
  saleorSchemaVersion: mockedSaleorSchemaVersionSupportingPaymentMethodDetails,
});

describe("PostgresTransactionRecorderRepo", () => {
  it("accepts an identical replay idempotently", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "installation-id" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            payment_intent_id: transaction.stripePaymentIntentId,
            saleor_transaction_id: transaction.saleorTransactionId,
            requested_flow: transaction.saleorTransactionFlow,
            resolved_flow: transaction.resolvedTransactionFlow,
            payment_method: transaction.selectedPaymentMethod,
            saleor_schema_major: 3,
            saleor_schema_minor: 22,
          },
        ],
      });
    const repo = new PostgresTransactionRecorderRepo({ query } as unknown as Pool);

    const result = await repo.recordTransaction(access, transaction);

    expect(result.isOk()).toBe(true);
  });

  it("rejects a conflicting PaymentIntent mapping", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "installation-id" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            payment_intent_id: transaction.stripePaymentIntentId,
            saleor_transaction_id: "different-transaction",
            requested_flow: transaction.saleorTransactionFlow,
            resolved_flow: transaction.resolvedTransactionFlow,
            payment_method: transaction.selectedPaymentMethod,
            saleor_schema_major: 3,
            saleor_schema_minor: 22,
          },
        ],
      });
    const repo = new PostgresTransactionRecorderRepo({ query } as unknown as Pool);

    const result = await repo.recordTransaction(access, transaction);

    expect(result.isErr()).toBe(true);
  });

  it("returns updated after persisting a timestamp-eligible status", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "installation-id" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const repo = new PostgresTransactionRecorderRepo({ query } as unknown as Pool);

    const result = await repo.recordStatus(access, {
      id: transaction.stripePaymentIntentId,
      status: "requires_capture",
      eventAt: new Date("2026-08-13T00:00:00Z"),
    });

    expect(result._unsafeUnwrap()).toBe("updated");
  });

  it("returns stale when a newer status already exists", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "installation-id" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ last_event_at: new Date() }] });
    const repo = new PostgresTransactionRecorderRepo({ query } as unknown as Pool);

    const result = await repo.recordStatus(access, {
      id: transaction.stripePaymentIntentId,
      status: "processing",
      eventAt: new Date("2026-08-13T00:00:00Z"),
    });

    expect(result._unsafeUnwrap()).toBe("stale");
  });

  it("returns TransactionMissingError when a status has no mapping", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "installation-id" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const repo = new PostgresTransactionRecorderRepo({ query } as unknown as Pool);

    const result = await repo.recordStatus(access, {
      id: transaction.stripePaymentIntentId,
      status: "processing",
      eventAt: new Date("2026-08-13T00:00:00Z"),
    });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(
      TransactionRecorderError.TransactionMissingError,
    );
  });

  it("returns FailedWritingTransactionError for a database failure", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const repo = new PostgresTransactionRecorderRepo({ query } as unknown as Pool);

    const result = await repo.recordStatus(access, {
      id: transaction.stripePaymentIntentId,
      status: "processing",
      eventAt: new Date("2026-08-13T00:00:00Z"),
    });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(
      TransactionRecorderError.FailedWritingTransactionError,
    );
  });
});
