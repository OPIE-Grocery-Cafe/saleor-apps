import { booleanEnv } from "@saleor/apps-shared/boolean-env";
import {
  newSecretKeyRuntimeEnv,
  newSecretKeyServerSchema,
} from "@saleor/apps-shared/secret-key-resolution";
import { formatEnvValidationError } from "@saleor/errors";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  server: {
    ...newSecretKeyServerSchema,
    ALLOWED_DOMAIN_PATTERN: z.string().optional(),
    COMMERCE_DATABASE_URL: z.string().url(),
    EXPECTED_COMMERCE_SCHEMA_VERSION: z.string().default("0001_initial.sql"),
    APP_API_BASE_URL: z.string().optional(),
    APP_IFRAME_BASE_URL: z.string().optional(),
    APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    MANIFEST_APP_ID: z.string().default("saleor.app.payment.stripe"),
    OTEL_ACCESS_TOKEN: z.string().optional(),
    OTEL_ENABLED: booleanEnv.defaultFalse,
    OTEL_SERVICE_NAME: z.string().default("saleor-app-payment-stripe"),
    PORT: z.coerce.number().default(3000),
    REPOSITORY_URL: z.string().optional(),
    SECRET_KEY: z.string(),
    VERCEL_ENV: z.string().optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
    STRIPE_PARTNER_ID: z.string().optional(),
    APPSTORE_URL: z.string().optional(),
    APP_NAME: z.string().default("Stripe"),
    OPIE_INTERNAL_SECRET: z.string().min(32).optional(),
    OPIE_INTERNAL_PREVIOUS_SECRET: z.string().min(32).optional(),
  },
  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    ENV: z.enum(["local", "development", "staging", "production"]).default("local"),
  },
  // we use the manual destruction here to validate if env variable is set inside turbo.json
  runtimeEnv: {
    ...newSecretKeyRuntimeEnv,
    ALLOWED_DOMAIN_PATTERN: process.env.ALLOWED_DOMAIN_PATTERN,
    COMMERCE_DATABASE_URL: process.env.COMMERCE_DATABASE_URL,
    EXPECTED_COMMERCE_SCHEMA_VERSION: process.env.EXPECTED_COMMERCE_SCHEMA_VERSION,
    APP_API_BASE_URL: process.env.APP_API_BASE_URL,
    APP_IFRAME_BASE_URL: process.env.APP_IFRAME_BASE_URL,
    APP_LOG_LEVEL: process.env.APP_LOG_LEVEL,
    ENV: process.env.ENV,
    MANIFEST_APP_ID: process.env.MANIFEST_APP_ID,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NODE_ENV: process.env.NODE_ENV,
    OTEL_ACCESS_TOKEN: process.env.OTEL_ACCESS_TOKEN,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    PORT: process.env.PORT,
    REPOSITORY_URL: process.env.REPOSITORY_URL,
    SECRET_KEY: process.env.SECRET_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    STRIPE_PARTNER_ID: process.env.STRIPE_PARTNER_ID,
    APPSTORE_URL: process.env.APPSTORE_URL,
    APP_NAME: process.env.APP_NAME,
    OPIE_INTERNAL_SECRET: process.env.OPIE_INTERNAL_SECRET,
    OPIE_INTERNAL_PREVIOUS_SECRET: process.env.OPIE_INTERNAL_PREVIOUS_SECRET,
  },
  isServer: typeof window === "undefined" || process.env.NODE_ENV === "test",
  onValidationError: formatEnvValidationError,
});
