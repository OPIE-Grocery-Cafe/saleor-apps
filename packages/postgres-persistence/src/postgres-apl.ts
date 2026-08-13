import { randomUUID } from "node:crypto";

import type { APL, AplConfiguredResult, AplReadyResult, AuthData } from "@saleor/app-sdk/APL";
import type { IEncryptor } from "@saleor/apps-shared/encryptor";
import type { Pool } from "pg";

import { assertIdentifier, withTransaction } from "./pool";

export type PostgresAplSchema = "stripe" | "smtp";

export class PostgresAPL implements APL {
  private readonly pool: Pool;
  private readonly schema: PostgresAplSchema;
  private readonly encryptor: IEncryptor;

  constructor(
    pool: Pool,
    schema: PostgresAplSchema,
    encryptor: IEncryptor,
  ) {
    assertIdentifier(schema);
    this.pool = pool;
    this.schema = schema;
    this.encryptor = encryptor;
  }

  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    const result = await this.pool.query<{
      token_ciphertext: string;
      saleor_api_url: string;
      app_id: string;
      jwks: string | null;
    }>(
      `SELECT token_ciphertext, saleor_api_url, app_id, jwks
         FROM ${this.schema}.saleor_installations
        WHERE saleor_api_url = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [saleorApiUrl],
    );
    const row = result.rows[0];

    if (!row) return undefined;

    return {
      appId: row.app_id,
      jwks: row.jwks ?? undefined,
      saleorApiUrl: row.saleor_api_url,
      token: this.encryptor.decrypt(row.token_ciphertext),
    };
  }

  async set(authData: AuthData): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `opie-commerce:${this.schema}:installation:${authData.saleorApiUrl}`,
      ]);
      const current = await client.query<{
        token_ciphertext: string;
        app_id: string;
        jwks: string | null;
      }>(
        `SELECT token_ciphertext, app_id, jwks
           FROM ${this.schema}.saleor_installations
          WHERE saleor_api_url = $1 AND revoked_at IS NULL
          FOR UPDATE`,
        [authData.saleorApiUrl],
      );
      const existing = current.rows[0];

      if (
        existing
        && existing.app_id === authData.appId
        && existing.jwks === (authData.jwks ?? null)
        && this.encryptor.decrypt(existing.token_ciphertext) === authData.token
      ) {
        return;
      }
      await client.query(
        `UPDATE ${this.schema}.saleor_installations
            SET revoked_at = now(), token_ciphertext = NULL, updated_at = now()
          WHERE saleor_api_url = $1 AND revoked_at IS NULL`,
        [authData.saleorApiUrl],
      );
      await client.query(
        `INSERT INTO ${this.schema}.saleor_installations
           (id, saleor_api_url, app_id, token_ciphertext, jwks, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [
          randomUUID(),
          authData.saleorApiUrl,
          authData.appId,
          this.encryptor.encrypt(authData.token),
          authData.jwks ?? null,
        ],
      );
    });
  }

  async delete(saleorApiUrl: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.schema}.saleor_installations
          SET revoked_at = now(), token_ciphertext = NULL, updated_at = now()
        WHERE saleor_api_url = $1 AND revoked_at IS NULL`,
      [saleorApiUrl],
    );
  }

  async getAll(): Promise<AuthData[]> {
    const result = await this.pool.query<{
      token_ciphertext: string;
      saleor_api_url: string;
      app_id: string;
      jwks: string | null;
    }>(
      `SELECT token_ciphertext, saleor_api_url, app_id, jwks
         FROM ${this.schema}.saleor_installations
        WHERE revoked_at IS NULL
        ORDER BY saleor_api_url`,
    );

    return result.rows.map((row) => ({
      appId: row.app_id,
      jwks: row.jwks ?? undefined,
      saleorApiUrl: row.saleor_api_url,
      token: this.encryptor.decrypt(row.token_ciphertext),
    }));
  }

  async isReady(): Promise<AplReadyResult> {
    try {
      await this.pool.query("SELECT 1");

      return { ready: true };
    } catch (error) {
      return { ready: false, error: toError(error) };
    }
  }

  async isConfigured(): Promise<AplConfiguredResult> {
    try {
      const result = await this.pool.query(
        `SELECT 1 FROM ${this.schema}.saleor_installations WHERE revoked_at IS NULL LIMIT 1`,
      );

      if (!result.rowCount) {
        return {
          configured: false,
          error: new Error(`No active ${this.schema} installation is configured`),
        };
      }

      return { configured: true };
    } catch (error) {
      return { configured: false, error: toError(error) };
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
