import { RotatingEncryptor } from "@saleor/apps-shared/key-rotation/rotating-encryptor";
import {
  resolveDecryptFallbacks,
  resolveEncryptKey,
} from "@saleor/apps-shared/secret-key-resolution";
import { getPostgresPool } from "@saleor/postgres-persistence";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

let pool: ReturnType<typeof getPostgresPool> | undefined;
let encryptor: RotatingEncryptor | undefined;

export const getStripePostgresPool = () => {
  if (!env.COMMERCE_DATABASE_URL) {
    throw new Error("COMMERCE_DATABASE_URL is required for PostgreSQL persistence");
  }
  pool ??= getPostgresPool({
    applicationName: "saleor-stripe",
    connectionString: env.COMMERCE_DATABASE_URL,
  });

  return pool;
};

export const getStripePostgresEncryptor = () => {
  encryptor ??= new RotatingEncryptor({
    primarySecret: resolveEncryptKey(env),
    fallbackSecrets: resolveDecryptFallbacks(env),
    logger: createLogger("StripePostgresEncryptor"),
  });

  return encryptor;
};
