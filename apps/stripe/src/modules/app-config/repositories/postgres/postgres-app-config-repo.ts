import type { IEncryptor } from "@saleor/apps-shared/encryptor";
import { findInstallationId, withTransaction } from "@saleor/postgres-persistence";
import { err, ok, type Result } from "neverthrow";
import type { Pool } from "pg";

import { type BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { AppRootConfig } from "@/modules/app-config/domain/app-root-config";
import { StripeConfig } from "@/modules/app-config/domain/stripe-config";
import {
  type AppConfigRepo,
  AppConfigRepoError,
  type BaseAccessPattern,
  type GetStripeConfigAccessPattern,
} from "@/modules/app-config/repositories/app-config-repo";
import { type SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { createStripePublishableKey } from "@/modules/stripe/stripe-publishable-key";
import { createStripeRestrictedKey } from "@/modules/stripe/stripe-restricted-key";
import { createStripeWebhookSecret } from "@/modules/stripe/stripe-webhook-secret";

type ConfigRow = {
  configuration_id: string;
  name: string;
  publishable_key: string;
  restricted_key_ciphertext: string;
  stripe_webhook_id: string;
  webhook_secret_ciphertext: string;
};

export class PostgresAppConfigRepo implements AppConfigRepo {
  private readonly logger = createLogger("PostgresAppConfigRepo");
  private readonly pool: Pool;
  private readonly encryptor: IEncryptor;

  constructor(pool: Pool, encryptor: IEncryptor) {
    this.pool = pool;
    this.encryptor = encryptor;
  }

  async getRootConfig(
    access: BaseAccessPattern,
  ): Promise<Result<AppRootConfig, InstanceType<typeof BaseError>>> {
    try {
      const installationId = await findInstallationId(this.pool, "stripe", access);

      if (!installationId) return ok(new AppRootConfig({}, {}));
      const [configs, mappings] = await Promise.all([
        this.pool.query<ConfigRow>(
          "SELECT configuration_id, name, publishable_key, restricted_key_ciphertext, stripe_webhook_id, webhook_secret_ciphertext FROM stripe.configurations WHERE installation_id = $1",
          [installationId],
        ),
        this.pool.query<{ channel_id: string; configuration_id: string | null }>(
          "SELECT channel_id, configuration_id FROM stripe.channel_config_mappings WHERE installation_id = $1",
          [installationId],
        ),
      ]);

      return ok(
        new AppRootConfig(
          Object.fromEntries(
            mappings.rows.flatMap((row) =>
              row.configuration_id ? [[row.channel_id, row.configuration_id]] : [],
            ),
          ),
          Object.fromEntries(
            configs.rows.map((row) => [row.configuration_id, this.mapConfig(row)]),
          ),
        ),
      );
    } catch (error) {
      this.logger.error("Failed to fetch Stripe root config from PostgreSQL", { cause: error });

      return err(
        new AppConfigRepoError.FailureFetchingConfig("Error fetching RootConfig from PostgreSQL", {
          cause: error,
        }),
      );
    }
  }

  async getStripeConfig(access: GetStripeConfigAccessPattern) {
    try {
      const installationId = await findInstallationId(this.pool, "stripe", access);

      if (!installationId) return ok(null);
      const result =
        "channelId" in access
          ? await this.pool.query<ConfigRow>(
              `SELECT c.configuration_id, c.name, c.publishable_key, c.restricted_key_ciphertext,
                    c.stripe_webhook_id, c.webhook_secret_ciphertext
               FROM stripe.channel_config_mappings m
               JOIN stripe.configurations c
                 ON c.installation_id = m.installation_id AND c.configuration_id = m.configuration_id
              WHERE m.installation_id = $1 AND m.channel_id = $2`,
              [installationId, access.channelId],
            )
          : await this.pool.query<ConfigRow>(
              `SELECT configuration_id, name, publishable_key, restricted_key_ciphertext,
                    stripe_webhook_id, webhook_secret_ciphertext
               FROM stripe.configurations
              WHERE installation_id = $1 AND configuration_id = $2`,
              [installationId, access.configId],
            );

      return ok(result.rows[0] ? this.mapConfig(result.rows[0]) : null);
    } catch (error) {
      return err(
        new AppConfigRepoError.FailureFetchingConfig(
          "Error fetching Stripe config from PostgreSQL",
          { cause: error },
        ),
      );
    }
  }

  async saveStripeConfig({
    config,
    appId,
    saleorApiUrl,
  }: {
    config: StripeConfig;
    saleorApiUrl: SaleorApiUrl;
    appId: string;
  }) {
    try {
      const installationId = await this.requireInstallation({ appId, saleorApiUrl });

      await this.pool.query(
        `INSERT INTO stripe.configurations
           (installation_id, configuration_id, name, publishable_key, restricted_key_ciphertext,
            stripe_webhook_id, webhook_secret_ciphertext)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (installation_id, configuration_id)
         DO UPDATE SET name = excluded.name, publishable_key = excluded.publishable_key,
                       restricted_key_ciphertext = excluded.restricted_key_ciphertext,
                       stripe_webhook_id = excluded.stripe_webhook_id,
                       webhook_secret_ciphertext = excluded.webhook_secret_ciphertext, updated_at = now()`,
        [
          installationId,
          config.id,
          config.name,
          config.publishableKey,
          this.encryptor.encrypt(config.restrictedKey),
          config.webhookId,
          this.encryptor.encrypt(config.webhookSecret),
        ],
      );

      return ok(null);
    } catch (error) {
      return err(
        new AppConfigRepoError.FailureSavingConfig("Failed to save config to PostgreSQL", {
          cause: error,
        }),
      );
    }
  }

  async updateMapping(
    access: BaseAccessPattern,
    data: { configId: string | null; channelId: string },
  ) {
    try {
      const installationId = await this.requireInstallation(access);

      await this.pool.query(
        `INSERT INTO stripe.channel_config_mappings (installation_id, channel_id, configuration_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (installation_id, channel_id)
         DO UPDATE SET configuration_id = excluded.configuration_id, updated_at = now()`,
        [installationId, data.channelId, data.configId],
      );

      return ok(null);
    } catch (error) {
      return err(
        new AppConfigRepoError.FailureSavingConfig("Failed to update mapping in PostgreSQL", {
          cause: error,
        }),
      );
    }
  }

  async removeConfig(access: BaseAccessPattern, data: { configId: string }) {
    try {
      const installationId = await this.requireInstallation(access);

      await withTransaction(this.pool, async (client) => {
        await client.query(
          "UPDATE stripe.channel_config_mappings SET configuration_id = NULL, updated_at = now() WHERE installation_id = $1 AND configuration_id = $2",
          [installationId, data.configId],
        );
        await client.query(
          "DELETE FROM stripe.configurations WHERE installation_id = $1 AND configuration_id = $2",
          [installationId, data.configId],
        );
      });

      return ok(null);
    } catch (error) {
      return err(
        new AppConfigRepoError.FailureRemovingConfig("Failed to remove config from PostgreSQL", {
          cause: error,
        }),
      );
    }
  }

  private mapConfig(row: ConfigRow): StripeConfig {
    return StripeConfig.create({
      id: row.configuration_id,
      name: row.name,
      publishableKey: createStripePublishableKey(row.publishable_key)._unsafeUnwrap(),
      restrictedKey: createStripeRestrictedKey(
        this.encryptor.decrypt(row.restricted_key_ciphertext),
      )._unsafeUnwrap(),
      webhookId: row.stripe_webhook_id,
      webhookSecret: createStripeWebhookSecret(
        this.encryptor.decrypt(row.webhook_secret_ciphertext),
      )._unsafeUnwrap(),
    })._unsafeUnwrap();
  }

  private async requireInstallation(access: BaseAccessPattern): Promise<string> {
    const installationId = await findInstallationId(this.pool, "stripe", access);

    if (!installationId) throw new Error("Active Stripe installation not found");

    return installationId;
  }
}
