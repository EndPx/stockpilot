// Explicit release gate. Database URLs stay in environment and are never printed.
import { readFile } from "node:fs/promises";
import pg from "pg";

async function main() {
  const ownerUrl = process.env.CONTROL_PLANE_MIGRATION_URL;
  const runtimeUrl = process.env.CONTROL_PLANE_DATABASE_URL;
  if (!ownerUrl || !runtimeUrl) throw new Error("Database configuration missing");
  const ownerAddress = new URL(ownerUrl);
  const runtimeAddress = new URL(runtimeUrl);
  if (ownerAddress.hostname !== runtimeAddress.hostname || ownerAddress.pathname !== runtimeAddress.pathname ||
    ownerAddress.username !== "neondb_owner" || runtimeAddress.username !== "stockpilot_app") {
    throw new Error("Unexpected database target or role");
  }
  const owner = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 20_000, statement_timeout: 20_000 });
  const runtime = new pg.Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 20_000, statement_timeout: 20_000 });
  try {
    await owner.connect();
    const sql = await readFile(new URL("../../../deploy/grant-runtime-agent-operations.sql", import.meta.url), "utf8");
    await owner.query(sql);
    await runtime.connect();
    const { rows } = await runtime.query(`SELECT
      current_user = 'stockpilot_app'
      AND has_table_privilege(current_user,'control_agent_operations','SELECT')
      AND has_table_privilege(current_user,'control_agent_operations','INSERT')
      AND has_table_privilege(current_user,'control_agent_operations','UPDATE')
      AND has_table_privilege(current_user,'control_agent_wallet_policies','SELECT')
      AND has_table_privilege(current_user,'control_agent_wallet_policies','INSERT')
      AND has_table_privilege(current_user,'control_agent_wallet_policies','UPDATE')
      AND has_table_privilege(current_user,'control_agent_operation_events','SELECT')
      AND has_table_privilege(current_user,'control_agent_operation_events','INSERT')
      AND has_table_privilege(current_user,'control_wallet_operation_locks','SELECT')
      AND has_table_privilege(current_user,'control_wallet_operation_locks','INSERT')
      AND has_table_privilege(current_user,'control_wallet_operation_locks','UPDATE')
      AND NOT has_table_privilege(current_user,'control_agent_operations','DELETE')
      AND NOT has_table_privilege(current_user,'control_agent_operation_events','UPDATE,DELETE') AS valid`);
    if (rows.length !== 1 || rows[0].valid !== true) throw new Error("Unexpected runtime privileges");
    process.stdout.write("Agent runtime grants verified.\n");
  } finally {
    await owner.end().catch(() => {});
    await runtime.end().catch(() => {});
  }
}

main().catch((error) => {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : "CHECK_FAILED";
  process.stderr.write(`Agent runtime grant gate failed (${code}). No credentials logged.\n`);
  process.exitCode = 1;
});
