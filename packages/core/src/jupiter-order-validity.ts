import type { JupiterOrder } from "@stockpilot/integrations/jupiter-v2";

const AGGREGATOR_ROUTERS = new Set(["metis", "dflow", "okx"]);
const MAX_U64 = 18_446_744_073_709_551_615n;

/** A local review deadline is not proof that the blockhash remains valid. */
export function inspectJupiterOrderValidity(
  order: Pick<JupiterOrder, "router" | "lastValidBlockHeight" | "expireAt">,
  nowMs: number,
  maxLifetimeMs: number,
): { expiresAtMs: number; lastValidBlockHeight: string | null } | null {
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxLifetimeMs) || maxLifetimeMs <= 0 ||
      nowMs + maxLifetimeMs > Number.MAX_SAFE_INTEGER) return null;
  const aggregator = AGGREGATOR_ROUTERS.has(order.router);
  const rfq = order.router === "jupiterz";
  if (!aggregator && !rfq) return null;

  const height = order.lastValidBlockHeight;
  if (height !== null && (typeof height !== "string" || !/^[1-9]\d{0,19}$/.test(height) || BigInt(height) > MAX_U64)) return null;
  if (aggregator && height === null) return null;

  const expiresAtMs = order.expireAt === null ? nowMs + maxLifetimeMs : Date.parse(order.expireAt);
  if (rfq && order.expireAt === null || !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= nowMs || expiresAtMs > nowMs + maxLifetimeMs) return null;
  return { expiresAtMs, lastValidBlockHeight: height };
}
