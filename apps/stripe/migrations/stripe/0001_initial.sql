CREATE TABLE stripe.saleor_installations (
  id uuid PRIMARY KEY,
  saleor_api_url text NOT NULL,
  app_id text NOT NULL,
  token_ciphertext text,
  jwks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT stripe_installation_token_required CHECK (revoked_at IS NOT NULL OR token_ciphertext IS NOT NULL)
);

CREATE UNIQUE INDEX stripe_one_active_installation_per_api
  ON stripe.saleor_installations (saleor_api_url) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX stripe_active_installation_identity
  ON stripe.saleor_installations (saleor_api_url, app_id) WHERE revoked_at IS NULL;

CREATE TABLE stripe.configurations (
  installation_id uuid NOT NULL REFERENCES stripe.saleor_installations(id),
  configuration_id text NOT NULL,
  name text NOT NULL,
  publishable_key text NOT NULL,
  restricted_key_ciphertext text NOT NULL,
  stripe_webhook_id text NOT NULL,
  webhook_secret_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, configuration_id)
);

CREATE TABLE stripe.channel_config_mappings (
  installation_id uuid NOT NULL REFERENCES stripe.saleor_installations(id),
  channel_id text NOT NULL,
  configuration_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, channel_id),
  FOREIGN KEY (installation_id, configuration_id)
    REFERENCES stripe.configurations(installation_id, configuration_id)
    ON DELETE SET NULL (configuration_id)
);

CREATE TABLE stripe.recorded_transactions (
  installation_id uuid NOT NULL REFERENCES stripe.saleor_installations(id),
  payment_intent_id text NOT NULL,
  saleor_transaction_id text NOT NULL,
  requested_flow text NOT NULL,
  resolved_flow text NOT NULL,
  payment_method text NOT NULL,
  saleor_schema_major integer NOT NULL,
  saleor_schema_minor integer NOT NULL,
  stripe_status text,
  last_event_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, payment_intent_id),
  UNIQUE (installation_id, saleor_transaction_id)
);
CREATE INDEX stripe_recorded_transactions_retention
  ON stripe.recorded_transactions (terminal_at) WHERE terminal_at IS NOT NULL;

CREATE TABLE stripe.stored_payment_customers (
  installation_id uuid NOT NULL REFERENCES stripe.saleor_installations(id),
  saleor_user_id text NOT NULL,
  stripe_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, saleor_user_id),
  UNIQUE (installation_id, stripe_customer_id)
);

DO $$ BEGIN
  IF to_regrole('stripe_runtime') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SCHEMA stripe TO stripe_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stripe TO stripe_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE stripe_migrator IN SCHEMA stripe GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stripe_runtime';
  END IF;
END $$;
