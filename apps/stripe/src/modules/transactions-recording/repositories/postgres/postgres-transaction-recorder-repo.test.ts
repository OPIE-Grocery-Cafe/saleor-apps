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
});
