import { assertDatabaseSchemaVersion, getPostgresPool } from "@saleor/postgres-persistence";

import { env } from "../../../../env";
import { apl } from "../../../../saleor-app";

export async function GET() {
  try {
    await assertDatabaseSchemaVersion({
      pool: getPostgresPool({
        applicationName: "saleor-smtp",
        connectionString: env.COMMERCE_DATABASE_URL,
      }),
      schema: "smtp",
      expectedVersion: env.EXPECTED_COMMERCE_SCHEMA_VERSION,
    });
    const ready = await apl.isReady?.();

    if (ready?.ready !== true) {
      throw new Error("SMTP persistence is not ready");
    }
    /*
     * An empty installation set is healthy during first deployment. Reading it proves the
     * runtime role can access installation state without preventing Saleor from installing it.
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
