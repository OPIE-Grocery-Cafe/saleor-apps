import type { IEncryptor } from "@saleor/apps-shared/encryptor";
import { describe, expect, it, vi } from "vitest";

import { PostgresAPL } from "./postgres-apl";

const encryptor: IEncryptor = {
  encrypt: (value) => `encrypted:${value}`,
  decrypt: (value) => value.replace(/^encrypted:/, ""),
};

describe("PostgresAPL", () => {
  it("decrypts active installation tokens without exposing ciphertext", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          token_ciphertext: "encrypted:token",
          saleor_api_url: "https://saleor.example/graphql/",
          app_id: "app-id",
          jwks: "jwks",
        }],
      }),
    };
    const apl = new PostgresAPL(pool as never, "stripe", encryptor);

    await expect(apl.get("https://saleor.example/graphql/")).resolves.toStrictEqual({
      token: "token",
      saleorApiUrl: "https://saleor.example/graphql/",
      appId: "app-id",
      jwks: "jwks",
    });
  });

  it("revokes an installation and clears its reusable token", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const apl = new PostgresAPL({ query } as never, "smtp", encryptor);

    await apl.delete("https://saleor.example/graphql/");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("token_ciphertext = NULL"), [
      "https://saleor.example/graphql/",
    ]);
  });

  it("reports configured before the first installation when the backend is usable", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const apl = new PostgresAPL({ query } as never, "stripe", encryptor);

    await expect(apl.isConfigured()).resolves.toMatchObject({
      configured: true,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("stripe.saleor_installations"));
  });
});
