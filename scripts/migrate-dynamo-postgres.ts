import { createHmac, randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { Encryptor } from "@saleor/apps-shared/encryptor";
import pg, { type Pool } from "pg";

type Mode = "inventory" | "migrate" | "verify" | "export-for-rollback";
type AppName = "stripe" | "smtp";
type Item = Record<string, unknown>;

const mode = parseMode(process.argv.slice(2));
const checksumKey = required("MIGRATION_CHECKSUM_KEY");
const directUrl = mode === "inventory" ? undefined : required("COMMERCE_DATABASE_DIRECT_URL");
const secretKeys: Partial<Record<AppName, string>> = mode === "inventory"
  ? {}
  : {
      stripe: requiredAny("STRIPE_SECRET_KEY", "SECRET_KEY"),
      smtp: requiredAny("SMTP_SECRET_KEY", "SECRET_KEY"),
    };
const appIds: Record<AppName, string> = {
  stripe: process.env.STRIPE_APP_ID ?? "saleor.app.payment.stripe",
  smtp: process.env.SMTP_APP_ID ?? "saleor.app.smtp",
};
const verifySaleorTokens = process.env.VERIFY_SALEOR_TOKENS !== "false";
const endpoint = process.env.AWS_ENDPOINT_URL;
const documentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint,
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: endpoint
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
        }
      : undefined,
  }),
);
const pool = directUrl ? new pg.Pool({ connectionString: directUrl, max: 2 }) : undefined;
const encryptors: Partial<Record<AppName, Encryptor>> = Object.fromEntries(
  Object.entries(secretKeys).map(([app, key]) => [app, new Encryptor(key)]),
);

try {
  const scans = new Map<string, Item[]>();

  for (const app of ["stripe", "smtp"] as const) {
    const tableName = required(app === "stripe" ? "DYNAMODB_STRIPE_TABLE_NAME" : "DYNAMODB_SMTP_TABLE_NAME");
    const discovered = scans.get(tableName) ?? await scanAll(tableName);

    scans.set(tableName, discovered);
    validateDiscoveredItems(discovered);
    const items = selectAppItems(app, discovered);
    validateAppItems(app, items);
    if (mode === "inventory") report(app, "dynamo", items);
    if (mode === "migrate") {
      await migrate(app, items);
      await verify(app, items);
    }
    if (mode === "verify") await verify(app, items);
    if (mode === "export-for-rollback") {
      const exported = await exportForRollback(app, tableName);
      report(app, "postgres-export", exported);
    }
  }
} finally {
  await pool?.end();
}

function parseMode(args: string[]): Mode {
  const candidate = args[0] as Mode | undefined;
  if (!candidate || !["inventory", "migrate", "verify", "export-for-rollback"].includes(candidate)) {
    throw new Error("Usage: migrate-dynamo-postgres <inventory|migrate|verify|export-for-rollback>");
  }
  return candidate;
}

async function scanAll(tableName: string): Promise<Item[]> {
  const items: Item[] = [];
  let key: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: key, ConsistentRead: true }));
    items.push(...(page.Items ?? []));
    key = page.LastEvaluatedKey;
  } while (key);
  return items;
}

function kind(item: Item): string {
  if (item.SK === "APL" || item._et === "APL") return "APL";
  const sk = String(item.SK ?? "");
  if (sk.startsWith("CONFIG_ID#")) return "StripeConfig";
  if (sk.startsWith("CHANNEL_ID#")) return "ChannelConfigMapping";
  if (sk.startsWith("TRANSACTION#")) return "RecordedTransaction";
  if (sk.startsWith("STORED_PAYMENT_CUSTOMER#")) return "StoredPaymentCustomer";
  const entity = String(item._et ?? "unknown");

  return entity.endsWith("Entity") ? entity.slice(0, -"Entity".length) : entity;
}

function validateDiscoveredItems(items: Item[]): void {
  const allowed = new Set(["APL", "StripeConfig", "ChannelConfigMapping", "RecordedTransaction", "StoredPaymentCustomer"]);
  const unknown = [...new Set(items.map(kind).filter((value) => !allowed.has(value)))];

  if (unknown.length) throw new Error(`DynamoDB contains unsupported entity types: ${unknown.join(", ")}`);
  for (const item of items) {
    if (!dynamoPartitionKey(item) || !dynamoSortKey(item)) {
      throw new Error("DynamoDB contains malformed key data");
    }
    if (kind(item) === "APL") {
      const auth = aplAuth(item);

      if (!auth.token || !auth.saleorApiUrl || !auth.appId) {
        throw new Error("DynamoDB contains malformed APL data");
      }
    }
  }
}

function dynamoPartitionKey(item: Item): unknown {
  return item.PK ?? item.pk;
}

function dynamoSortKey(item: Item): unknown {
  return item.SK ?? item.sk;
}

function selectAppItems(app: AppName, items: Item[]): Item[] {
  const expectedAppId = appIds[app];

  return items.filter((item) => {
    if (kind(item) === "APL") return aplAuth(item).appId === expectedAppId;
    if (app === "smtp") return false;
    return parseInstallationKey(String(item.PK)).appId === expectedAppId;
  });
}

function validateAppItems(app: AppName, items: Item[]): void {
  const apl = items.filter((item) => kind(item) === "APL");

  if (apl.length === 0) throw new Error(`${app} APL record was not found for app ID ${appIds[app]}`);
  const installationKeys = new Set(apl.map((item) => {
    const auth = aplAuth(item);

    return `${auth.saleorApiUrl}#${auth.appId}`;
  }));

  if (installationKeys.size !== apl.length) throw new Error(`${app} contains duplicate installation identities`);
  if (app === "smtp" && items.some((item) => kind(item) !== "APL")) {
    throw new Error("SMTP migration only supports APL records");
  }
  if (app === "stripe") {
    validateStripeRecords(items);
    validateStripeIdentities(items);
  }
}

function validateStripeRecords(items: Item[]): void {
  for (const item of items) {
    const requiredFields = {
      APL: [],
      StripeConfig: ["configId", "configName", "stripePk", "stripeRk", "stripeWhId", "stripeWhSecret"],
      ChannelConfigMapping: ["channelId"],
      RecordedTransaction: ["paymentIntentId", "saleorTransactionId", "saleorTransactionFlow", "resolvedTransactionFlow", "selectedPaymentMethod", "saleorSchemaVersion"],
      StoredPaymentCustomer: ["saleorUserId", "stripeCustomerId"],
    }[kind(item)];

    if (!requiredFields) throw new Error(`Unsupported Stripe record type: ${kind(item)}`);
    const missing = requiredFields.filter((field) => item[field] === undefined || item[field] === null || item[field] === "");

    if (missing.length) throw new Error(`Malformed ${kind(item)} record; missing ${missing.join(", ")}`);
    if (kind(item) === "RecordedTransaction") {
      const version = item.saleorSchemaVersion as { major?: unknown; minor?: unknown };

      if (!Number.isInteger(Number(version.major)) || !Number.isInteger(Number(version.minor))) {
        throw new Error("Malformed RecordedTransaction Saleor schema version");
      }
    }
  }
}

function validateStripeIdentities(items: Item[]): void {
  const transactions = items.filter((item) => kind(item) === "RecordedTransaction");
  assertUnique(transactions, (item) => `${item.PK}#pi:${item.paymentIntentId}`, "PaymentIntent mapping");
  assertUnique(transactions, (item) => `${item.PK}#saleor:${item.saleorTransactionId}`, "Saleor transaction mapping");
  const customers = items.filter((item) => kind(item) === "StoredPaymentCustomer");
  assertUnique(customers, (item) => `${item.PK}#user:${item.saleorUserId}`, "Saleor customer mapping");
  assertUnique(customers, (item) => `${item.PK}#stripe:${item.stripeCustomerId}`, "Stripe customer mapping");
}

function assertUnique(items: Item[], key: (item: Item) => string, label: string): void {
  const seen = new Set<string>();

  for (const item of items) {
    const identity = key(item);

    if (seen.has(identity)) throw new Error(`Duplicate ${label}: ${identity}`);
    seen.add(identity);
  }
}

async function migrate(app: AppName, items: Item[]): Promise<void> {
  const encryptor = encryptors[app];
  if (!pool || !encryptor) throw new Error(`PostgreSQL ${app} migration dependencies are unavailable`);
  const aplItems = items.filter((item) => kind(item) === "APL");
  for (const item of aplItems) {
    const auth = aplAuth(item);

    await pool.query(
      `INSERT INTO ${app}.saleor_installations
         (id, saleor_api_url, app_id, token_ciphertext, jwks, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), COALESCE($7::timestamptz, now()))
       ON CONFLICT (saleor_api_url, app_id) WHERE revoked_at IS NULL
       DO UPDATE SET token_ciphertext = excluded.token_ciphertext, jwks = excluded.jwks,
                     updated_at = excluded.updated_at`,
      [randomUUID(), auth.saleorApiUrl, auth.appId, encryptor.encrypt(auth.token), auth.jwks ?? null, item.createdAt ?? null, item.modifiedAt ?? null],
    );
  }
  if (app === "smtp") return;
  const migrationOrder = ["StripeConfig", "ChannelConfigMapping", "RecordedTransaction", "StoredPaymentCustomer"];

  for (const item of items
    .filter((entry) => kind(entry) !== "APL")
    .sort((left, right) => migrationOrder.indexOf(kind(left)) - migrationOrder.indexOf(kind(right)))) {
    const access = parseInstallationKey(String(item.PK));
    const installationId = await installation("stripe", access.saleorApiUrl, access.appId);
    switch (kind(item)) {
      case "StripeConfig":
        await pool.query(
          `INSERT INTO stripe.configurations
             (installation_id, configuration_id, name, publishable_key, restricted_key_ciphertext,
              stripe_webhook_id, webhook_secret_ciphertext, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,now()),COALESCE($9::timestamptz,now()))
           ON CONFLICT (installation_id, configuration_id) DO UPDATE SET
             name=excluded.name, publishable_key=excluded.publishable_key,
             restricted_key_ciphertext=excluded.restricted_key_ciphertext,
             stripe_webhook_id=excluded.stripe_webhook_id,
             webhook_secret_ciphertext=excluded.webhook_secret_ciphertext, updated_at=excluded.updated_at`,
          [installationId, item.configId, item.configName, item.stripePk, item.stripeRk, item.stripeWhId, item.stripeWhSecret, item.createdAt ?? null, item.modifiedAt ?? null],
        );
        break;
      case "ChannelConfigMapping":
        await pool.query(
          `INSERT INTO stripe.channel_config_mappings
             (installation_id, channel_id, configuration_id, created_at, updated_at)
           VALUES ($1,$2,$3,COALESCE($4::timestamptz,now()),COALESCE($5::timestamptz,now()))
           ON CONFLICT (installation_id, channel_id) DO UPDATE SET
             configuration_id=excluded.configuration_id, updated_at=excluded.updated_at`,
          [installationId, item.channelId, item.configId ?? null, item.createdAt ?? null, item.modifiedAt ?? null],
        );
        break;
      case "RecordedTransaction": {
        const version = item.saleorSchemaVersion as { major?: unknown; minor?: unknown } | undefined;
        await pool.query(
          `INSERT INTO stripe.recorded_transactions
             (installation_id,payment_intent_id,saleor_transaction_id,requested_flow,resolved_flow,
              payment_method,saleor_schema_major,saleor_schema_minor,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,now()),COALESCE($10::timestamptz,now()))
           ON CONFLICT DO NOTHING`,
          [installationId, item.paymentIntentId, item.saleorTransactionId, item.saleorTransactionFlow, item.resolvedTransactionFlow, item.selectedPaymentMethod, version?.major, version?.minor, item.createdAt ?? null, item.modifiedAt ?? null],
        );
        break;
      }
      case "StoredPaymentCustomer":
        await pool.query(
          `INSERT INTO stripe.stored_payment_customers
             (installation_id,saleor_user_id,stripe_customer_id,created_at,updated_at)
           VALUES ($1,$2,$3,COALESCE($4::timestamptz,now()),COALESCE($5::timestamptz,now()))
           ON CONFLICT DO NOTHING`,
          [installationId, item.saleorUserId, item.stripeCustomerId, item.createdAt ?? null, item.modifiedAt ?? null],
        );
        break;
    }
  }
  console.info(`migrated ${app}: count=${items.length} checksum=${checksum(items)}`);
}

async function verify(app: AppName, source: Item[]): Promise<void> {
  if (!pool) throw new Error("PostgreSQL verification is unavailable");
  const exported = await readPostgresAsDynamo(app);
  if (source.length !== exported.length || checksum(source) !== checksum(exported)) {
    throw new Error(`${app} semantic verification failed (source=${source.length}, target=${exported.length})`);
  }
  for (const item of verifySaleorTokens ? exported.filter((entry) => kind(entry) === "APL") : []) {
    const auth = aplAuth(item);
    const response = await fetch(auth.saleorApiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "query OpieMigrationVerify { shop { name } }" }),
    });
    const body = await response.json() as { errors?: unknown[] };
    if (!response.ok || body.errors?.length) throw new Error(`${app} migrated APL token failed Saleor authentication`);
  }
  console.info(`verified ${app}: count=${source.length} checksum=${checksum(source)}`);
}

async function exportForRollback(app: AppName, tableName: string): Promise<Item[]> {
  const items = await readPostgresAsDynamo(app);
  for (const item of items) await documentClient.send(new PutCommand({ TableName: tableName, Item: item }));
  return items;
}

async function readPostgresAsDynamo(app: AppName): Promise<Item[]> {
  const encryptor = encryptors[app];
  if (!pool || !encryptor) throw new Error(`PostgreSQL ${app} export dependencies are unavailable`);
  const installations = await pool.query<{
    saleor_api_url: string; app_id: string; token_ciphertext: string; jwks: string | null;
    created_at: Date; updated_at: Date;
  }>(`SELECT saleor_api_url, app_id, token_ciphertext, jwks, created_at, updated_at FROM ${app}.saleor_installations WHERE revoked_at IS NULL`);
  const items: Item[] = installations.rows.map((row) => ({
    PK: row.saleor_api_url, SK: "APL", _et: "APL", saleorApiUrl: row.saleor_api_url,
    appId: row.app_id, token: encryptor.decrypt(row.token_ciphertext), ...(row.jwks ? { jwks: row.jwks } : {}),
    createdAt: row.created_at.toISOString(), modifiedAt: row.updated_at.toISOString(),
  }));
  if (app === "smtp") return items;
  const configs = await pool.query(`SELECT i.saleor_api_url, i.app_id, c.* FROM stripe.configurations c JOIN stripe.saleor_installations i ON i.id=c.installation_id WHERE i.revoked_at IS NULL`);
  for (const row of configs.rows) items.push({
    PK: `${row.saleor_api_url}#${row.app_id}`, SK: `CONFIG_ID#${row.configuration_id}`, _et: "StripeConfig",
    configId: row.configuration_id, configName: row.name, stripePk: row.publishable_key,
    stripeRk: row.restricted_key_ciphertext, stripeWhId: row.stripe_webhook_id,
    stripeWhSecret: row.webhook_secret_ciphertext, createdAt: row.created_at.toISOString(), modifiedAt: row.updated_at.toISOString(),
  });
  const mappings = await pool.query(`SELECT i.saleor_api_url, i.app_id, m.* FROM stripe.channel_config_mappings m JOIN stripe.saleor_installations i ON i.id=m.installation_id WHERE i.revoked_at IS NULL`);
  for (const row of mappings.rows) items.push({ PK: `${row.saleor_api_url}#${row.app_id}`, SK: `CHANNEL_ID#${row.channel_id}`, _et: "ChannelConfigMapping", channelId: row.channel_id, ...(row.configuration_id ? { configId: row.configuration_id } : {}), createdAt: row.created_at.toISOString(), modifiedAt: row.updated_at.toISOString() });
  const transactions = await pool.query(`SELECT i.saleor_api_url, i.app_id, t.* FROM stripe.recorded_transactions t JOIN stripe.saleor_installations i ON i.id=t.installation_id WHERE i.revoked_at IS NULL`);
  for (const row of transactions.rows) items.push({ PK: `${row.saleor_api_url}#${row.app_id}`, SK: `TRANSACTION#${row.payment_intent_id}`, _et: "RecordedTransaction", paymentIntentId: row.payment_intent_id, saleorTransactionId: row.saleor_transaction_id, saleorTransactionFlow: row.requested_flow, resolvedTransactionFlow: row.resolved_flow, selectedPaymentMethod: row.payment_method, saleorSchemaVersion: { major: row.saleor_schema_major, minor: row.saleor_schema_minor }, createdAt: row.created_at.toISOString(), modifiedAt: row.updated_at.toISOString() });
  const customers = await pool.query(`SELECT i.saleor_api_url, i.app_id, c.* FROM stripe.stored_payment_customers c JOIN stripe.saleor_installations i ON i.id=c.installation_id WHERE i.revoked_at IS NULL`);
  for (const row of customers.rows) items.push({ PK: `${row.saleor_api_url}#${row.app_id}`, SK: `STORED_PAYMENT_CUSTOMER#${row.saleor_user_id}`, _et: "StoredPaymentCustomer", saleorUserId: row.saleor_user_id, stripeCustomerId: row.stripe_customer_id, createdAt: row.created_at.toISOString(), modifiedAt: row.updated_at.toISOString() });
  return items;
}

async function installation(schema: AppName, saleorApiUrl: string, appId: string): Promise<string> {
  if (!pool) throw new Error("PostgreSQL installation lookup is unavailable");
  const result = await pool.query<{ id: string }>(`SELECT id FROM ${schema}.saleor_installations WHERE saleor_api_url=$1 AND app_id=$2 AND revoked_at IS NULL`, [saleorApiUrl, appId]);
  if (!result.rows[0]) throw new Error(`Missing ${schema} installation for dependent records`);
  return result.rows[0].id;
}

function parseInstallationKey(value: string): { saleorApiUrl: string; appId: string } {
  const marker = "/graphql/#";
  const index = value.indexOf(marker);
  if (index < 0) throw new Error("Malformed installation-scoped DynamoDB key");
  return { saleorApiUrl: value.slice(0, index + "/graphql/".length), appId: value.slice(index + marker.length) };
}

function report(app: AppName, source: string, items: Item[]): void {
  const counts = Object.fromEntries([...new Set(items.map(kind))].sort().map((type) => [type, items.filter((item) => kind(item) === type).length]));
  console.info(`${app} ${source}: count=${items.length} types=${JSON.stringify(counts)} checksum=${checksum(items)}`);
}

function aplAuth(item: Item): { saleorApiUrl: string; appId: string; token: string; jwks?: string } {
  const auth = (item.authData && typeof item.authData === "object"
    ? item.authData
    : item) as Record<string, unknown>;

  return {
    saleorApiUrl: String(auth.saleorApiUrl ?? ""),
    appId: String(auth.appId ?? ""),
    token: String(auth.token ?? ""),
    ...(auth.jwks ? { jwks: String(auth.jwks) } : {}),
  };
}

function checksum(items: Item[]): string {
  const normalized = items.map((item) => canonical(item)).sort().join("\n");
  return createHmac("sha256", checksumKey).update(normalized).digest("hex");
}

function canonical(item: Item): string {
  const ignored = new Set(["_ct", "_md", "_et", "createdAt", "modifiedAt"]);
  return JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => !ignored.has(key)).sort(([a], [b]) => a.localeCompare(b))));
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredAny(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}
