import { type APL } from "@saleor/app-sdk/APL";
import { DynamoAPL } from "@saleor/app-sdk/APL/dynamodb";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { UpstashAPL } from "@saleor/app-sdk/APL/upstash";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { RotatingEncryptor } from "@saleor/apps-shared/key-rotation/rotating-encryptor";
import {
  resolveDecryptFallbacks,
  resolveEncryptKey,
} from "@saleor/apps-shared/secret-key-resolution";
import { getPostgresPool, PostgresAPL } from "@saleor/postgres-persistence";

import { env } from "./env";
import { getDynamoEnv } from "./env-dynamodb";
import { createLogger } from "./logger";
import { createDynamoMainTable } from "./modules/dynamodb/dynamo-main-table";

const logger = createLogger("saleor-app");

const aplType = env.PERSISTENCE_BACKEND === "postgres" ? "postgres" : env.APL;

export let apl: APL;

switch (aplType) {
  case "postgres": {
    if (!env.COMMERCE_DATABASE_URL) {
      throw new Error("COMMERCE_DATABASE_URL is required for PostgreSQL persistence");
    }
    const pool = getPostgresPool({
      applicationName: "saleor-smtp",
      connectionString: env.COMMERCE_DATABASE_URL,
    });
    const encryptor = new RotatingEncryptor({
      primarySecret: resolveEncryptKey(env),
      fallbackSecrets: resolveDecryptFallbacks(env),
      logger: createLogger("SmtpPostgresEncryptor"),
    });

    apl = new PostgresAPL(pool, "smtp", encryptor);
    break;
  }
  case "dynamodb": {
    const dynamoEnv = getDynamoEnv();
    const dynamoMainTable = createDynamoMainTable(dynamoEnv);

    apl = DynamoAPL.create({
      table: dynamoMainTable,
      externalLogger: (message, level) => {
        if (level === "error") {
          logger.error(`[DynamoAPL] ${message}`);
        } else {
          logger.debug(`[DynamoAPL] ${message}`);
        }
      },
    });

    break;
  }

  case "upstash":
    apl = new UpstashAPL();

    break;

  case "file":
    apl = new FileAPL();

    break;

  default: {
    throw new Error("Invalid APL config, ");
  }
}
export const saleorApp = new SaleorApp({
  apl,
});

export const REQUIRED_SALEOR_VERSION = ">=3.11.7 <4";
