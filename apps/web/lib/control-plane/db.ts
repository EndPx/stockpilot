import "server-only";
import { Pool, type PoolClient } from "pg";

const globalDatabase = globalThis as typeof globalThis & { stockpilotControlPool?: Pool };

export function getControlPool(): Pool {
  const connectionString = process.env.CONTROL_PLANE_DATABASE_URL;
  if (!connectionString) throw new Error("Control-plane database is not configured");
  if (globalDatabase.stockpilotControlPool) return globalDatabase.stockpilotControlPool;
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
  });
  pool.on("error", () => {
    // Never log the connection string or query parameters.
    console.error("An idle control-plane database connection failed");
  });
  return globalDatabase.stockpilotControlPool = pool;
}

export async function inControlTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getControlPool().connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
}
