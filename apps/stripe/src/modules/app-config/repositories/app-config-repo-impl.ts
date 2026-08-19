import { PostgresAppConfigRepo } from "@/modules/app-config/repositories/postgres/postgres-app-config-repo";
import { getStripePostgresEncryptor, getStripePostgresPool } from "@/modules/postgres/postgres";

export const appConfigRepoImpl = new PostgresAppConfigRepo(
  getStripePostgresPool(),
  getStripePostgresEncryptor(),
);
