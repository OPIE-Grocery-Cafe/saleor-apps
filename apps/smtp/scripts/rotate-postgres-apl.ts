import {
  resolveRotationSourceKeys,
  resolveRotationTargetKey,
} from "@saleor/apps-shared/secret-key-resolution";
import { rotatePostgresEncryptedColumns } from "@saleor/postgres-persistence/key-rotation";

import { env } from "../src/env";

if (env.PERSISTENCE_BACKEND === "postgres") {
  const result = await rotatePostgresEncryptedColumns({
    connectionString: env.COMMERCE_DATABASE_URL ?? "",
    schema: "smtp",
    sourceKeys: resolveRotationSourceKeys(env),
    targetKey: resolveRotationTargetKey(env),
    dryRun: process.argv.includes("--dry-run"),
    columns: [
      { table: "saleor_installations", keyColumns: ["id"], valueColumn: "token_ciphertext" },
    ],
  });

  if (result.failed) process.exitCode = 1;
}
