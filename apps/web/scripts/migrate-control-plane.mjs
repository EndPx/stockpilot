import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const connectionString = process.env.CONTROL_PLANE_DATABASE_URL;
if (!connectionString) throw new Error("CONTROL_PLANE_DATABASE_URL is required");

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = (await readdir(migrationsDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
if (files.length === 0) throw new Error("No control-plane migrations found");

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3_000 });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('stockpilot-control-plane-migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS control_schema_migrations (
    name text PRIMARY KEY,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const name of files) {
    const sql = await readFile(join(migrationsDirectory, name), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query("SELECT sha256 FROM control_schema_migrations WHERE name = $1", [name]);
    if (existing.rows.length) {
      if (existing.rows[0].sha256 !== sha256) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO control_schema_migrations(name, sha256) VALUES ($1, $2)", [name, sha256]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('stockpilot-control-plane-migrations'))").catch(() => {});
  client.release();
  await pool.end();
}
