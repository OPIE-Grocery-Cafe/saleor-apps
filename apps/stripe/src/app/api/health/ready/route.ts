import { assertDatabaseSchemaVersion } from "@saleor/postgres-persistence";

import { env } from "@/lib/env";
import { apl } from "@/lib/saleor-app";
import { getStripePostgresPool } from "@/modules/postgres/postgres";

export async function GET() {
  try {
    await assertDatabaseSchemaVersion({
      pool: getStripePostgresPool(),
      schema: "stripe",
      expectedVersion: env.EXPECTED_COMMERCE_SCHEMA_VERSION,
    });
    const ready = await apl.isReady?.();

    if (ready?.ready !== true) {
      throw new Error("Stripe persistence is not ready");
    }
    /*
     * Reading an empty installation set is valid during a fresh deployment. Requiring an
     * installation here creates a bootstrap deadlock: Saleor cannot install an app whose
     * deployment is held unhealthy. getAll still verifies the runtime role can read APL state.
     */
    await apl.getAll();

    return Response.json({ status: "ready", persistence: "postgres" });
  } catch (error) {
    return Response.json(
      { status: "not_ready", error: error instanceof Error ? error.message : "unknown" },
      { status: 503 },
    );
  }
}
