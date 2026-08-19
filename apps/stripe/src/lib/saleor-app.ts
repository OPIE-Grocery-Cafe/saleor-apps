import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { PostgresAPL } from "@saleor/postgres-persistence/apl";

import { getStripePostgresEncryptor, getStripePostgresPool } from "@/modules/postgres/postgres";

export const apl = new PostgresAPL(getStripePostgresPool(), "stripe", getStripePostgresEncryptor());

export const saleorApp = new SaleorApp({
  apl,
});
