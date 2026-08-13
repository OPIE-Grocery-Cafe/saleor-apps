import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { RotatingEncryptor } from "@saleor/apps-shared/key-rotation/rotating-encryptor";
import {
  resolveDecryptFallbacks,
  resolveEncryptKey,
} from "@saleor/apps-shared/secret-key-resolution";
import { getPostgresPool, PostgresAPL } from "@saleor/postgres-persistence";

import { env } from "./env";
import { createLogger } from "./logger";

const pool = getPostgresPool({
  applicationName: "saleor-smtp",
  connectionString: env.COMMERCE_DATABASE_URL,
});
const encryptor = new RotatingEncryptor({
  primarySecret: resolveEncryptKey(env),
  fallbackSecrets: resolveDecryptFallbacks(env),
  logger: createLogger("SmtpPostgresEncryptor"),
});

export const apl = new PostgresAPL(pool, "smtp", encryptor);
export const saleorApp = new SaleorApp({
  apl,
});

export const REQUIRED_SALEOR_VERSION = ">=3.11.7 <4";
