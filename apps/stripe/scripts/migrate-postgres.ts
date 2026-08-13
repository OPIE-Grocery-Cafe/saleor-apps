import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "@saleor/postgres-persistence/migration-runner";

// Migration scripts intentionally read their one-shot service environment.
// eslint-disable-next-line n/no-process-env
const connectionString = process.env.COMMERCE_DATABASE_DIRECT_URL;

if (!connectionString) throw new Error("COMMERCE_DATABASE_DIRECT_URL is required");
await runMigrations({
  connectionString,
  directory: join(dirname(fileURLToPath(import.meta.url)), "../migrations/stripe"),
  schema: "stripe",
});
