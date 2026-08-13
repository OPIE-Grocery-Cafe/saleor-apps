import type { IEncryptor } from "@saleor/apps-shared/encryptor";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { mockedSaleorAppId } from "@/__tests__/mocks/constants";
import { mockedStripeConfig } from "@/__tests__/mocks/mock-stripe-config";
import { mockedSaleorApiUrl } from "@/__tests__/mocks/saleor-api-url";

import { PostgresAppConfigRepo } from "./postgres-app-config-repo";

const encryptor: IEncryptor = {
  encrypt: (value) => `encrypted:${value}`,
  decrypt: (value) => value.replace(/^encrypted:/, ""),
};

describe("PostgresAppConfigRepo", () => {
  it("encrypts Stripe secrets before saving configuration", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "installation-id" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const repo = new PostgresAppConfigRepo({ query } as unknown as Pool, encryptor);

    const result = await repo.saveStripeConfig({
      appId: mockedSaleorAppId,
      saleorApiUrl: mockedSaleorApiUrl,
      config: mockedStripeConfig,
    });

    expect(result.isOk()).toBe(true);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO stripe.configurations"),
      expect.arrayContaining([
        `encrypted:${mockedStripeConfig.restrictedKey}`,
        `encrypted:${mockedStripeConfig.webhookSecret}`,
      ]),
    );
  });

  it("clears mappings and deletes configuration in one transaction", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "installation-id" }] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const repo = new PostgresAppConfigRepo(pool, encryptor);

    const result = await repo.removeConfig(
      { appId: mockedSaleorAppId, saleorApiUrl: mockedSaleorApiUrl },
      { configId: mockedStripeConfig.id },
    );

    expect(result.isOk()).toBe(true);
    expect(client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0])).toStrictEqual([
      "BEGIN",
      "UPDATE",
      "DELETE",
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
