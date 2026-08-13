import { env } from "@/lib/env";
import { getStripePostgresPool } from "@/modules/postgres/postgres";
import { DynamoDBTransactionRecorderRepo } from "@/modules/transactions-recording/repositories/dynamodb/dynamodb-transaction-recorder-repo";
import { PostgresTransactionRecorderRepo } from "@/modules/transactions-recording/repositories/postgres/postgres-transaction-recorder-repo";
import { type TransactionRecorderRepo } from "@/modules/transactions-recording/repositories/transaction-recorder-repo";

/**
 * When forking, you can replace this only file with custom implementation, to replace DynamoDB with another storage
 */
export const transactionRecorder: TransactionRecorderRepo =
  env.PERSISTENCE_BACKEND === "postgres"
    ? new PostgresTransactionRecorderRepo(getStripePostgresPool())
    : new DynamoDBTransactionRecorderRepo();
