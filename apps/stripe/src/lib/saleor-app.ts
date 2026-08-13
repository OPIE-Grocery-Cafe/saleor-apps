import { type APL } from "@saleor/app-sdk/APL";
import { DynamoAPL } from "@saleor/app-sdk/APL/dynamodb";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { PostgresAPL } from "@saleor/postgres-persistence/apl";

import { createLogger } from "@/lib/logger";
import { dynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";
import { getStripePostgresEncryptor, getStripePostgresPool } from "@/modules/postgres/postgres";

import { env } from "./env";

const logger = createLogger("saleor-app");

export let apl: APL;
const aplType = env.PERSISTENCE_BACKEND === "postgres" ? "postgres" : env.APL;

switch (aplType) {
  case "postgres": {
    apl = new PostgresAPL(getStripePostgresPool(), "stripe", getStripePostgresEncryptor());
    break;
  }
  case "dynamodb": {
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

  default: {
    apl = new FileAPL();
    break;
  }
}

export const saleorApp = new SaleorApp({
  apl,
});
