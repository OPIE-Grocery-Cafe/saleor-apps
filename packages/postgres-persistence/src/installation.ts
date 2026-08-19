import type { Pool, PoolClient } from "pg";

import { assertIdentifier } from "./pool";

export async function findInstallationId(
  db: Pool | PoolClient,
  schema: string,
  access: { saleorApiUrl: string; appId: string },
): Promise<string | null> {
  assertIdentifier(schema);
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM ${schema}.saleor_installations
      WHERE saleor_api_url = $1 AND app_id = $2 AND revoked_at IS NULL
      LIMIT 1`,
    [access.saleorApiUrl, access.appId],
  );

  return result.rows[0]?.id ?? null;
}
