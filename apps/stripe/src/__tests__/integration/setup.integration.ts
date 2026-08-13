import { afterAll, beforeEach } from "vitest";

import { getStripePostgresPool } from "@/modules/postgres/postgres";

process.env.TZ = "UTC";

beforeEach(async () => {
  const pool = getStripePostgresPool();

  await pool.query("DELETE FROM stripe.stored_payment_customers");
  await pool.query("DELETE FROM stripe.recorded_transactions");
  await pool.query("DELETE FROM stripe.channel_config_mappings");
  await pool.query("DELETE FROM stripe.configurations");
  await pool.query("DELETE FROM stripe.saleor_installations");
});

afterAll(async () => {
  await getStripePostgresPool().end();
});
