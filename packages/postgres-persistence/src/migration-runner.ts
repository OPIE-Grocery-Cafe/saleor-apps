import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import pg from "pg";

import { assertIdentifier, withTransaction } from "./pool";

const { Pool } = pg;

export async function runMigrations(args: {
  connectionString: string;
  directory: string;
  schema: string;
}): Promise<void> {
  assertIdentifier(args.schema);
  const pool = new Pool({ connectionString: args.connectionString, max: 1 });

  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${args.schema}.schema_migrations (
         version text PRIMARY KEY,
         checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = (await readdir(args.directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();

    for (const file of files) {
      const sql = await readFile(join(args.directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await pool.query<{ checksum: string }>(
        `SELECT checksum FROM ${args.schema}.schema_migrations WHERE version = $1`,
        [file],
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Migration checksum mismatch: ${file}`);
        }
        continue;
      }
      await withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `opie-commerce:${args.schema}:migrations`,
        ]);
        const raced = await client.query<{ checksum: string }>(
          `SELECT checksum FROM ${args.schema}.schema_migrations WHERE version = $1`,
          [file],
        );

        if (raced.rows[0]) {
          if (raced.rows[0].checksum !== checksum) {
            throw new Error(`Migration checksum mismatch: ${file}`);
          }

          return;
        }
        await client.query(sql);
        await client.query(
          `INSERT INTO ${args.schema}.schema_migrations (version, checksum) VALUES ($1, $2)`,
          [file, checksum],
        );
      });
    }
  } finally {
    await pool.end();
  }
}
