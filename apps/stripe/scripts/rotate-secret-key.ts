import { parseArgs } from "node:util";

import {
  resolveRotationSourceKeys,
  resolveRotationTargetKey,
} from "@saleor/apps-shared/secret-key-resolution";
import { rotatePostgresEncryptedColumns } from "@saleor/postgres-persistence/key-rotation";
import { scrubSensitiveEventData } from "@saleor/sentry-utils/scrub-sensitive-event-data";
import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/env";

import { createMigrationScriptLogger } from "./migration-logger";

const {
  values: { "dry-run": dryRun },
} = parseArgs({
  options: {
    "dry-run": {
      type: "boolean",
      default: false,
    },
  },
});

const logger = createMigrationScriptLogger("RotateSecretKey");

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN,
  environment: env.ENV,
  includeLocalVariables: false,
  beforeSend: scrubSensitiveEventData,
  skipOpenTelemetrySetup: true,
  ignoreErrors: [],
  integrations: [],
});

const run = () =>
  rotatePostgresEncryptedColumns({
    connectionString: env.COMMERCE_DATABASE_URL,
    schema: "stripe",
    sourceKeys: resolveRotationSourceKeys(env),
    targetKey: resolveRotationTargetKey(env),
    dryRun: dryRun ?? false,
    columns: [
      { table: "saleor_installations", keyColumns: ["id"], valueColumn: "token_ciphertext" },
      {
        table: "configurations",
        keyColumns: ["installation_id", "configuration_id"],
        valueColumn: "restricted_key_ciphertext",
      },
      {
        table: "configurations",
        keyColumns: ["installation_id", "configuration_id"],
        valueColumn: "webhook_secret_ciphertext",
      },
    ],
  });

run()
  .then(({ failed }) => {
    if (failed > 0) process.exit(1);
  })
  .catch(async (error) => {
    logger.error("Fatal error during secret key rotation", { error: error });
    Sentry.captureException(error);
    await Sentry.flush(5000);
    process.exit(1);
  });
