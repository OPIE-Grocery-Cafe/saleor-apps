import { PostgresAPL } from "@saleor/postgres-persistence";
import { describe, expect, it } from "vitest";

import {
  mockedSaleorAppId,
  mockedSaleorSchemaVersionSupportingPaymentMethodDetails,
  mockedSaleorTransactionId,
} from "@/__tests__/mocks/constants";
import { mockedStripeConfig } from "@/__tests__/mocks/mock-stripe-config";
import { mockedSaleorApiUrl } from "@/__tests__/mocks/saleor-api-url";
import { PostgresAppConfigRepo } from "@/modules/app-config/repositories/postgres/postgres-app-config-repo";
import { getStripePostgresEncryptor, getStripePostgresPool } from "@/modules/postgres/postgres";
import { createResolvedTransactionFlow } from "@/modules/resolved-transaction-flow";
import { createSaleorTransactionFlow } from "@/modules/saleor/saleor-transaction-flow";
import { createStripePaymentIntentId } from "@/modules/stripe/stripe-payment-intent-id";
import { RecordedTransaction } from "@/modules/transactions-recording/domain/recorded-transaction";
import { PostgresTransactionRecorderRepo } from "@/modules/transactions-recording/repositories/postgres/postgres-transaction-recorder-repo";
import { TransactionRecorderError } from "@/modules/transactions-recording/repositories/transaction-recorder-repo";

const access = { appId: mockedSaleorAppId, saleorApiUrl: mockedSaleorApiUrl };

async function install() {
  const apl = new PostgresAPL(getStripePostgresPool(), "stripe", getStripePostgresEncryptor());

  await apl.set({
    appId: mockedSaleorAppId,
    jwks: "{}",
    saleorApiUrl: mockedSaleorApiUrl,
    token: "saleor-app-token",
  });

  return apl;
}

function transaction(paymentIntentId = "pi_postgres_integration") {
  return new RecordedTransaction({
    saleorTransactionId: mockedSaleorTransactionId,
    stripePaymentIntentId: createStripePaymentIntentId(paymentIntentId),
    saleorTransactionFlow: createSaleorTransactionFlow("AUTHORIZATION"),
    resolvedTransactionFlow: createResolvedTransactionFlow("AUTHORIZATION"),
    selectedPaymentMethod: "card",
    saleorSchemaVersion: mockedSaleorSchemaVersionSupportingPaymentMethodDetails,
  });
}

describe("Stripe PostgreSQL persistence", () => {
  it("preserves APL identity through install, revoke, and reinstall", async () => {
    const apl = await install();

    await expect(apl.get(mockedSaleorApiUrl)).resolves.toMatchObject({
      appId: mockedSaleorAppId,
      token: "saleor-app-token",
    });

    await apl.delete(mockedSaleorApiUrl);
    await expect(apl.get(mockedSaleorApiUrl)).resolves.toBeUndefined();

    await apl.set({
      appId: mockedSaleorAppId,
      jwks: '{"keys":[]}',
      saleorApiUrl: mockedSaleorApiUrl,
      token: "replacement-token",
    });
    await expect(apl.get(mockedSaleorApiUrl)).resolves.toMatchObject({
      token: "replacement-token",
    });
    await expect(apl.getAll()).resolves.toHaveLength(1);
  });

  it("round-trips encrypted configuration and channel mapping", async () => {
    await install();
    const repo = new PostgresAppConfigRepo(getStripePostgresPool(), getStripePostgresEncryptor());

    expect(
      (
        await repo.saveStripeConfig({
          ...access,
          config: mockedStripeConfig,
        })
      ).isOk(),
    ).toBe(true);
    expect(
      (
        await repo.updateMapping(access, {
          channelId: "channel-postgres",
          configId: mockedStripeConfig.id,
        })
      ).isOk(),
    ).toBe(true);

    const resolved = await repo.getStripeConfig({ ...access, channelId: "channel-postgres" });

    expect(resolved._unsafeUnwrap()).toMatchObject({
      id: mockedStripeConfig.id,
      restrictedKey: mockedStripeConfig.restrictedKey,
      webhookSecret: mockedStripeConfig.webhookSecret,
    });
  });

  it("enforces idempotent transaction mappings and ordered status updates", async () => {
    await install();
    const repo = new PostgresTransactionRecorderRepo(getStripePostgresPool());
    const recorded = transaction();

    expect((await repo.recordTransaction(access, recorded)).isOk()).toBe(true);
    expect((await repo.recordTransaction(access, recorded)).isOk()).toBe(true);
    expect(
      (
        await repo.recordStatus(access, {
          id: recorded.stripePaymentIntentId,
          status: "requires_capture",
          eventAt: new Date("2026-08-13T12:00:00Z"),
        })
      )._unsafeUnwrap(),
    ).toBe("updated");
    expect(
      (
        await repo.recordStatus(access, {
          id: recorded.stripePaymentIntentId,
          status: "processing",
          eventAt: new Date("2026-08-13T11:59:59Z"),
        })
      )._unsafeUnwrap(),
    ).toBe("stale");

    const missing = await repo.recordStatus(access, {
      id: createStripePaymentIntentId("pi_missing"),
      status: "succeeded",
      eventAt: new Date("2026-08-13T12:00:01Z"),
    });

    expect(missing._unsafeUnwrapErr()).toBeInstanceOf(
      TransactionRecorderError.TransactionMissingError,
    );
  });

  it("proves stripe_runtime cannot use DDL, manage roles, or read smtp", async () => {
    const pool = getStripePostgresPool();

    await expect(pool.query("CREATE TABLE stripe.runtime_escape(id integer)")).rejects.toThrow();
    await expect(pool.query("CREATE ROLE stripe_runtime_escape")).rejects.toThrow();
    await expect(pool.query("SELECT * FROM smtp.saleor_installations")).rejects.toThrow();
  });
});
