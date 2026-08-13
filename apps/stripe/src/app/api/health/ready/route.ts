import { assertDatabaseSchemaVersion } from "@saleor/postgres-persistence";

import { env } from "@/lib/env";
import { apl } from "@/lib/saleor-app";
import { getStripePostgresPool } from "@/modules/postgres/postgres";

export async function GET() {
  try {
    if (env.PERSISTENCE_BACKEND === "postgres") {
      await assertDatabaseSchemaVersion({
        pool: getStripePostgresPool(),
        schema: "stripe",
        expectedVersion: env.EXPECTED_COMMERCE_SCHEMA_VERSION,
      });
    }
    const ready = await apl.isReady?.();
    const configured = await apl.isConfigured?.();

    if (ready?.ready !== true || configured?.configured !== true) {
      throw new Error("Stripe persistence is not ready");
    }
    const installations = await apl.getAll();

    if (!installations.length) throw new Error("Stripe installation state is missing");

    return Response.json({ status: "ready", persistence: env.PERSISTENCE_BACKEND });
  } catch (error) {
    return Response.json(
      { status: "not_ready", error: error instanceof Error ? error.message : "unknown" },
      { status: 503 },
    );
  }
}
