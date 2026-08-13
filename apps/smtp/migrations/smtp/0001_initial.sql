CREATE TABLE smtp.saleor_installations (
  id uuid PRIMARY KEY,
  saleor_api_url text NOT NULL,
  app_id text NOT NULL,
  token_ciphertext text,
  jwks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT smtp_installation_token_required CHECK (revoked_at IS NOT NULL OR token_ciphertext IS NOT NULL)
);

CREATE UNIQUE INDEX smtp_one_active_installation_per_api
  ON smtp.saleor_installations (saleor_api_url) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX smtp_active_installation_identity
  ON smtp.saleor_installations (saleor_api_url, app_id) WHERE revoked_at IS NULL;

DO $$ BEGIN
  IF to_regrole('smtp_runtime') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SCHEMA smtp TO smtp_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA smtp TO smtp_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE smtp_migrator IN SCHEMA smtp GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smtp_runtime';
  END IF;
END $$;
