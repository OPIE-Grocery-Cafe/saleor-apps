import { parseArgs } from "node:util";

import { scrubSensitiveEventData } from "@saleor/sentry-utils/scrub-sensitive-event-data";
import { WebhookMigrationRunner } from "@saleor/webhook-utils";
import * as Sentry from "@sentry/nextjs";

import { appWebhookDefinitions } from "@/app/api/webhooks/saleor/app-webhook-definitions";
import { env } from "@/lib/env";
import { createInstrumentedGraphqlClient } from "@/lib/graphql-client";
import { saleorApp } from "@/lib/saleor-app";

import { createMigrationScriptLogger } from "./migration-logger";

const {
  values: { "dry-run": dryRun },
} = parseArgs({
  options: {
    "dry-run": {
      type: "boolean",
      default: false,
    },
  },
});

const logger = createMigrationScriptLogger("WebhooksMigrationScript");

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN,
  environment: env.ENV,
  includeLocalVariables: false,
  beforeSend: scrubSensitiveEventData,
  skipOpenTelemetrySetup: true,
  ignoreErrors: [],
  integrations: [],
});

const runMigrations = async () => {
  logger.info(`Starting webhooks migration`);

  const saleorAPL = saleorApp.apl;

  const saleorCloudEnv = await saleorAPL.getAll().catch(() => {
    logger.error("Could not fetch installations from the PostgreSQL APL");

    process.exit(1);
  });

  await Promise.allSettled(
    saleorCloudEnv.map(async (saleorEnv) => {
      const { saleorApiUrl, token } = saleorEnv;

      logger.info(`Migrating webhooks for ${saleorApiUrl}`);

      const client = createInstrumentedGraphqlClient({
        saleorApiUrl: saleorApiUrl,
        token: token,
      });

      const runner = new WebhookMigrationRunner({
        dryRun,
        logger,
        client,
        saleorApiUrl,
        getManifests: async ({ appDetails }) => {
          const webhooks = appDetails.webhooks;

          if (!webhooks?.length) {
            logger.warn("The environment does not have any webhooks, skipping");

            return [];
          }

          // All webhooks in this application are turned on or off. If any of them is enabled, we enable all of them.
          const enabled = webhooks.some((w) => w.isActive);

          const targetUrl = appDetails.appUrl;

          if (!targetUrl?.length) {
            /*
             * Skip the installation. An empty list would not skip it: the runner removes every
             * installed webhook the list does not name.
             */
            throw new Error("App has no defined appUrl, skipping its webhooks");
          }

          const baseUrl = new URL(targetUrl).origin;

          // The whole list: the runner removes any installed webhook this does not name.
          const appWebhooks = appWebhookDefinitions.map((definition) => ({
            ...definition.getWebhookManifest(baseUrl),
            isActive: enabled,
          }));

          return appWebhooks;
        },
      });

      await runner.migrate().catch((error) => {
        Sentry.captureException(error);
      });
    }),
  );
};

runMigrations();

process.on("beforeExit", () => {
  logger.info("Webhook migration complete for all PostgreSQL installations");
  process.exit(0);
});
