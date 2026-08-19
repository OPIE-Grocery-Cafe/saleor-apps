import { Encryptor } from "@saleor/apps-shared/encryptor";
import type { PoolClient } from "pg";

import { assertIdentifier, createPostgresPool, withTransaction } from "./pool";

export type EncryptedColumn = { table: string; keyColumns: string[]; valueColumn: string };

export async function rotatePostgresEncryptedColumns(args: {
  connectionString: string;
  schema: string;
  sourceKeys: string[];
  targetKey: string;
  columns: EncryptedColumn[];
  dryRun: boolean;
  batchSize?: number;
}): Promise<{ rotated: number; failed: number }> {
  assertIdentifier(args.schema);
  for (const column of args.columns) {
    assertIdentifier(column.table);
    if (!column.keyColumns.length) throw new Error("Encrypted columns require at least one key column");
    column.keyColumns.forEach(assertIdentifier);
    assertIdentifier(column.valueColumn);
  }
  const pool = createPostgresPool({ connectionString: args.connectionString, max: 1, applicationName: "secret-key-rotation" });
  let rotated = 0;
  let failed = 0;

  try {
    for (const column of args.columns) {
      const keyArray = `ARRAY[${column.keyColumns.map((key) => `${key}::text`).join(", ")}]`;

      await pool.query(
        "CREATE TEMP TABLE IF NOT EXISTS rotation_progress (key_values text[] PRIMARY KEY) ON COMMIT PRESERVE ROWS",
      );
      await pool.query("TRUNCATE rotation_progress");
      await pool.query(
        `INSERT INTO rotation_progress(key_values)
         SELECT ${keyArray} FROM ${args.schema}.${column.table}
          WHERE ${column.valueColumn} IS NOT NULL`,
      );

      while (true) {
        const result = await withTransaction(pool, async (client) =>
          rotateBatch(client, { ...args, column, batchSize: args.batchSize ?? 100 }),
        );

        rotated += result.rotated;
        failed += result.failed;
        if (result.remaining === 0) break;
        if (result.seen === 0) {
          throw new Error(
            `${result.remaining} encrypted rows remained locked; rerun rotation after their transactions finish`,
          );
        }
      }
    }

    return { rotated, failed };
  } finally {
    await pool.end();
  }
}

async function rotateBatch(
  client: PoolClient,
  args: {
    schema: string;
    sourceKeys: string[];
    targetKey: string;
    column: EncryptedColumn;
    batchSize: number;
    dryRun: boolean;
  },
): Promise<{ seen: number; rotated: number; failed: number; remaining: number }> {
  const { schema, column } = args;
  const keySelect = column.keyColumns
    .map((key, index) => `target.${key}::text AS key_${index}`)
    .join(", ");
  const keyArray = `ARRAY[${column.keyColumns.map((key) => `target.${key}::text`).join(", ")}]`;
  const orderBy = column.keyColumns.join(", ");
  const rows = await client.query<Record<string, string>>(
    `SELECT ${keySelect}, target.${column.valueColumn} AS value
       FROM ${schema}.${column.table} AS target
       JOIN rotation_progress AS progress ON progress.key_values = ${keyArray}
      WHERE target.${column.valueColumn} IS NOT NULL
      ORDER BY ${orderBy.split(", ").map((key) => `target.${key}`).join(", ")}
      FOR UPDATE OF target SKIP LOCKED LIMIT $1`,
    [args.batchSize],
  );
  let rotated = 0;
  let failed = 0;

  for (const row of rows.rows) {
    const keys = column.keyColumns.map((_, index) => row[`key_${index}`]);

    try {
      const plaintext = decryptWithKeys(row.value, args.sourceKeys);

      if (!args.dryRun) {
        const predicates = column.keyColumns
          .map((key, index) => `${key}::text = $${index + 2}`)
          .join(" AND ");

        await client.query(
          `UPDATE ${schema}.${column.table}
              SET ${column.valueColumn} = $1, updated_at = now()
            WHERE ${predicates}`,
          [new Encryptor(args.targetKey).encrypt(plaintext), ...keys],
        );
      }
      rotated += 1;
    } catch {
      failed += 1;
    }
    await client.query("DELETE FROM rotation_progress WHERE key_values = $1::text[]", [keys]);
  }

  const remaining = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM rotation_progress",
  );

  return {
    seen: rows.rows.length,
    rotated,
    failed,
    remaining: Number(remaining.rows[0]?.count ?? 0),
  };
}

function decryptWithKeys(value: string, keys: string[]): string {
  for (const key of keys) {
    try {
      return new Encryptor(key).decrypt(value);
    } catch {
      // Try the next configured rotation source key.
    }
  }
  throw new Error("Encrypted value could not be decrypted by any source key");
}
