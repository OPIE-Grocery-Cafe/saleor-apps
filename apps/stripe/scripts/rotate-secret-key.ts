import { parseArgs } from "node:util";

import { Encryptor } from "@saleor/apps-shared/encryptor";
import { createDynamoDBSecretKeyRotationRunner } from "@saleor/apps-shared/key-rotation/dynamodb-secret-key-rotation-runner";
import {
  resolveRotationSourceKeys,
  resolveRotationTargetKey,
} from "@saleor/apps-shared/secret-key-resolution";
import { rotatePostgresEncryptedColumns } from "@saleor/postgres-persistence/key-rotation";
import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/env";
import {
  createDynamoDBClient,
  createDynamoDBDocumentClient,
} from "@/modules/dynamodb/dynamodb-client";

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
  includeLocalVariables: true,
  skipOpenTelemetrySetup: true,
  ignoreErrors: [],
  integrations: [],
});

const run =
  env.PERSISTENCE_BACKEND === "postgres"
    ? () =>
        rotatePostgresEncryptedColumns({
          connectionString: env.COMMERCE_DATABASE_URL ?? "",
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
        })
    : () => {
        const documentClient = createDynamoDBDocumentClient(
          createDynamoDBClient({ requestTimeout: 30_000, connectionTimeout: 10_000 }),
        );

        return createDynamoDBSecretKeyRotationRunner({
          secretKey: resolveRotationTargetKey(env),
          fallbackKeys: resolveRotationSourceKeys(env),
          dryRun: dryRun ?? false,
          logger,
          documentClient,
          tableName: env.DYNAMODB_MAIN_TABLE_NAME ?? "",
          encryptedFieldNames: ["stripeRk", "stripeWhSecret"],
          decrypt: (value, key) => new Encryptor(key).decrypt(value),
          encrypt: (plaintext, key) => new Encryptor(key).encrypt(plaintext),
        }).run();
      };

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
