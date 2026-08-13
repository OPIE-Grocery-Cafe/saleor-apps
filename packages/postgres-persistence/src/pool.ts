import pg, { type Pool, type PoolClient } from "pg";

const { Pool: PgPool } = pg;

export type PostgresRuntimeConfig = {
  connectionString: string;
  max?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  applicationName?: string;
};

const pools = new Map<string, Pool>();

export function createPostgresPool(config: PostgresRuntimeConfig): Pool {
  if (!config.connectionString) {
    throw new Error("COMMERCE_DATABASE_URL is required for PostgreSQL persistence");
  }

  return new PgPool({
    application_name: config.applicationName ?? "saleor-app",
    connectionString: config.connectionString,
    max: config.max ?? 5,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 2_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    /*
     * PgBouncer transaction pooling rejects PostgreSQL startup parameters such
     * as statement_timeout. node-postgres enforces query_timeout client-side
     * without adding a startup parameter to the pooled connection.
     */
    query_timeout: config.statementTimeoutMillis ?? 5_000,
  });
}

export function getPostgresPool(config: PostgresRuntimeConfig): Pool {
  const key = `${config.applicationName ?? "saleor-app"}:${config.connectionString}`;
  const existing = pools.get(key);

  if (existing) return existing;
  const pool = createPostgresPool(config);

  pools.set(key, pool);

  return pool;
}

export async function closePostgresPool(config: PostgresRuntimeConfig): Promise<void> {
  const key = `${config.applicationName ?? "saleor-app"}:${config.connectionString}`;
  const pool = pools.get(key);

  if (!pool) return;
  pools.delete(key);
  await pool.end();
}

export async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function assertDatabaseSchemaVersion(args: {
  pool: Pool;
  schema: string;
  expectedVersion: string;
}): Promise<void> {
  assertIdentifier(args.schema);
  const result = await args.pool.query<{ version: string }>(
    `SELECT version FROM ${args.schema}.schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1`,
  );
  const actual = result.rows[0]?.version;

  if (actual !== args.expectedVersion) {
    throw new Error(
      `Incompatible ${args.schema} database schema: expected ${args.expectedVersion}, found ${actual ?? "none"}`,
    );
  }
}

export function assertIdentifier(identifier: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
}
