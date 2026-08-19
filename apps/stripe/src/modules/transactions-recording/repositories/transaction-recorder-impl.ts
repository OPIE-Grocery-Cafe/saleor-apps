import { getStripePostgresPool } from "@/modules/postgres/postgres";
import { PostgresTransactionRecorderRepo } from "@/modules/transactions-recording/repositories/postgres/postgres-transaction-recorder-repo";
import { type TransactionRecorderRepo } from "@/modules/transactions-recording/repositories/transaction-recorder-repo";

export const transactionRecorder: TransactionRecorderRepo = new PostgresTransactionRecorderRepo(
  getStripePostgresPool(),
);
