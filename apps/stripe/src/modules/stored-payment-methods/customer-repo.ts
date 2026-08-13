import { findInstallationId } from "@saleor/postgres-persistence";
import type { Pool } from "pg";

import { type SaleorApiUrl } from "@/modules/saleor/saleor-api-url";

export type StoredPaymentAccess = { saleorApiUrl: SaleorApiUrl; appId: string };

export class StoredPaymentCustomerRepo {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async get(access: StoredPaymentAccess, saleorUserId: string): Promise<string | null> {
    const installationId = await this.requireInstallation(access);
    const result = await this.pool.query<{ stripe_customer_id: string }>(
      "SELECT stripe_customer_id FROM stripe.stored_payment_customers WHERE installation_id = $1 AND saleor_user_id = $2",
      [installationId, saleorUserId],
    );

    return result.rows[0]?.stripe_customer_id ?? null;
  }

  async put(
    access: StoredPaymentAccess,
    saleorUserId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    const installationId = await this.requireInstallation(access);
    const result = await this.pool.query<{ stripe_customer_id: string }>(
      `INSERT INTO stripe.stored_payment_customers (installation_id, saleor_user_id, stripe_customer_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (installation_id, saleor_user_id) DO NOTHING
       RETURNING stripe_customer_id`,
      [installationId, saleorUserId, stripeCustomerId],
    );

    if (result.rowCount === 1) return;
    const existing = await this.get(access, saleorUserId);

    if (existing !== stripeCustomerId)
      throw new Error("Conflicting Saleor user/Stripe customer mapping");
  }

  private async requireInstallation(access: StoredPaymentAccess): Promise<string> {
    const installationId = await findInstallationId(this.pool, "stripe", access);

    if (!installationId) throw new Error("Active Stripe installation not found");

    return installationId;
  }
}
