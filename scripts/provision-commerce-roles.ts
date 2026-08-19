import pg from "pg";

const connectionString = required("COMMERCE_DATABASE_ADMIN_URL");
const databaseName = process.env.COMMERCE_DATABASE_NAME ?? "opie_commerce";
const roles = [
  ["stripe_migrator", required("STRIPE_MIGRATOR_PASSWORD")],
  ["stripe_runtime", required("STRIPE_RUNTIME_PASSWORD")],
  ["pricing_migrator", required("PRICING_MIGRATOR_PASSWORD")],
  ["pricing_runtime", required("PRICING_RUNTIME_PASSWORD")],
  ["pricing_sync", required("PRICING_SYNC_PASSWORD")],
  ["smtp_migrator", required("SMTP_MIGRATOR_PASSWORD")],
  ["smtp_runtime", required("SMTP_RUNTIME_PASSWORD")],
] as const;
const pool = new pg.Pool({ connectionString, max: 1 });

try {
  await pool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  for (const [role, password] of roles) {
    const exists = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
      [role],
    );
    if (!exists.rows[0]?.exists) {
      await pool.query(`CREATE ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)}`);
    } else {
      await pool.query(`ALTER ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)}`);
    }
    await pool.query(`GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO ${identifier(role)}`);
    await pool.query(`ALTER ROLE ${identifier(role)} SET statement_timeout = '5s'`);
  }
  for (const schema of ["stripe", "pricing", "smtp"] as const) {
    const migrator = `${schema}_migrator`;
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${identifier(schema)} AUTHORIZATION ${identifier(migrator)}`);
    await pool.query(`ALTER SCHEMA ${identifier(schema)} OWNER TO ${identifier(migrator)}`);
    await pool.query(`REVOKE ALL ON SCHEMA ${identifier(schema)} FROM PUBLIC`);
  }
  console.info("Commerce PostgreSQL roles and schema ownership provisioned");
} finally {
  await pool.end();
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Unsafe PostgreSQL identifier");
  return `"${value}"`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
