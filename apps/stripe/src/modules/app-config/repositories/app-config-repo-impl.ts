import { env } from "@/lib/env";
import { DynamodbAppConfigRepo } from "@/modules/app-config/repositories/dynamodb/dynamodb-app-config-repo";
import { PostgresAppConfigRepo } from "@/modules/app-config/repositories/postgres/postgres-app-config-repo";
import { getStripePostgresEncryptor, getStripePostgresPool } from "@/modules/postgres/postgres";

/*
 * Replace this implementation with custom DB (Redis, Metadata etc) to drop DynamoDB and bring something else
 */
export const appConfigRepoImpl =
  env.PERSISTENCE_BACKEND === "postgres"
    ? new PostgresAppConfigRepo(getStripePostgresPool(), getStripePostgresEncryptor())
    : new DynamodbAppConfigRepo();
