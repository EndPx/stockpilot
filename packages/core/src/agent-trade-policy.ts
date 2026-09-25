/**
 * Pure, fail-closed decision for a future agent trade gateway. All inputs must
 * come from server-verified identity and consistent database reads, never from
 * the agent's tool arguments. AUTO_ALLOWED is not permission to sign: a caller
 * must atomically reserve budget, validate the exact route, and recheck this
 * policy and delegation immediately before signing and submission.
 */

const DAY_MS = 86_400_000;
const MAX_USAGE_AGE_MS = 5_000;
const MAX_USAGE_ENTRIES = 4_096;
const MAX_U64 = 18_446_744_073_709_551_615n;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PRIVY_USER_ID = /^did:privy:[A-Za-z0-9_-]{1,118}$/;
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{16,128}$/;

export type AgentTradeMarket = "STOCKS" | "PRE_IPO";
export type AgentTradeSide = "BUY" | "SELL";
export type AgentTradeMode = "DISABLED" | "APPROVAL" | "AUTO";

export type AgentTradeBinding = {
  accountId: string;
  clientId: string;
  walletAddress: string;
};

/** Must be loaded from the live StockPilot grant, never inferred from OAuth claims. */
export type AgentTradePrincipal = AgentTradeBinding & { scopes: readonly string[] };

/** BUY uses canonical USDC micro-units; SELL uses the asset's raw token units. */
export type AgentTradeIntent = AgentTradeBinding & {
  clientRequestId: string;
  side: AgentTradeSide;
  market: AgentTradeMarket;
  assetId: string;
  amountRaw: string;
};

export type AgentTradeLimit = {
  perTradeRaw: string | null;
  rolling24hRaw: string | null;
  /** NULL is unlimited only after two explicit owner choices. */
  unlimitedPerTradeOwnerOptIn: boolean;
  unlimited24hOwnerOptIn: boolean;
};

export type AgentTradePolicy = AgentTradeBinding & {
  active: boolean;
  version: number;
  expiresAtMs: number;
  buyMode: AgentTradeMode;
  sellMode: AgentTradeMode;
  autoTradingOwnerOptIn: boolean;
  allowedMarkets: readonly AgentTradeMarket[];
  /** USDC-micro limits apply across all BUYs by this client. */
  buyLimit: AgentTradeLimit;
  /** Absence is a denial; limits for a SELL are specific to this raw-unit asset. */
  assetRule: {
    market: AgentTradeMarket;
    assetId: string;
    sellLimit: AgentTradeLimit;
  } | null;
};

export type AgentTradeDelegation = AgentTradeBinding & {
  ready: boolean;
  walletId: string | null;
  privyPolicyReady: boolean;
  verifiedAtMs: number;
  expiresAtMs: number;
};

/** An unresolved or ambiguous trade remains RESERVED, even after 24 hours. */
export type AgentTradeUsageEntry = AgentTradeBinding & {
  side: AgentTradeSide;
  assetId: string;
  amountRaw: string;
  status: "RESERVED" | "FINALIZED";
  /** Reservation time or finalized settlement time, respectively. */
  accountedAtMs: number;
};

export type AgentTradeUsageSnapshot = {
  complete: boolean;
  asOfMs: number;
  entries: readonly AgentTradeUsageEntry[];
};

export type AgentTradeDecisionInput = {
  principal: AgentTradePrincipal;
  intent: AgentTradeIntent;
  policy: AgentTradePolicy;
  delegation: AgentTradeDelegation | null;
  usage: AgentTradeUsageSnapshot;
  expectedPolicyVersion: number;
  nowMs: number;
};

export type AgentTradeRejectionReason =
  | "INVALID_INTENT"
  | "IDENTITY_MISMATCH"
  | "SCOPE_NOT_GRANTED"
  | "POLICY_UNAVAILABLE"
  | "POLICY_VERSION_MISMATCH"
  | "POLICY_EXPIRED"
  | "ASSET_NOT_ALLOWED"
  | "MODE_DISABLED"
  | "INVALID_LIMIT"
  | "UNBOUNDED_NOT_AUTHORIZED"
  | "LIMIT_EXCEEDED"
  | "USAGE_UNAVAILABLE"
  | "OWNER_OPT_IN_REQUIRED"
  | "DELEGATION_NOT_READY";

export type AgentTradeDecision =
  | { decision: "AUTO_ALLOWED" | "APPROVAL_REQUIRED"; policyVersion: number }
  | { decision: "REJECTED"; reason: AgentTradeRejectionReason };

function reject(reason: AgentTradeRejectionReason): AgentTradeDecision {
  return { decision: "REJECTED", reason };
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validBinding(value: AgentTradeBinding): boolean {
  return !!value && typeof value.accountId === "string" && PRIVY_USER_ID.test(value.accountId) &&
    typeof value.clientId === "string" && CLIENT_ID.test(value.clientId) &&
    typeof value.walletAddress === "string" && SOLANA_ADDRESS.test(value.walletAddress);
}

function validPrincipal(value: AgentTradePrincipal): boolean {
  return validBinding(value) && Array.isArray(value.scopes) && value.scopes.length <= 32 &&
    value.scopes.every((scope) => typeof scope === "string" && scope.length > 0 && scope.length <= 80) &&
    new Set(value.scopes).size === value.scopes.length;
}

function sameBinding(a: AgentTradeBinding, b: AgentTradeBinding): boolean {
  return a.accountId === b.accountId && a.clientId === b.clientId && a.walletAddress === b.walletAddress;
}

function rawU64(value: string, allowZero = false): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value)) return null;
  const raw = BigInt(value);
  return raw <= MAX_U64 && (allowZero || raw > 0n) ? raw : null;
}

function validAssetId(market: AgentTradeMarket, assetId: string): boolean {
  if (typeof assetId !== "string") return false;
  const prefix = market === "STOCKS" ? "xstocks:" : "prestocks:";
  return assetId.startsWith(prefix) && SOLANA_ADDRESS.test(assetId.slice(prefix.length));
}

function validUsageAssetId(assetId: string): boolean {
  return validAssetId("STOCKS", assetId) || validAssetId("PRE_IPO", assetId);
}

function validLimit(limit: AgentTradeLimit): boolean {
  return !!limit && typeof limit.unlimitedPerTradeOwnerOptIn === "boolean" &&
    typeof limit.unlimited24hOwnerOptIn === "boolean" &&
    (limit.perTradeRaw === null || rawU64(limit.perTradeRaw) !== null) &&
    (limit.rolling24hRaw === null || rawU64(limit.rolling24hRaw) !== null);
}

/** The caller must hold account and policy locks while reading usage and reserving this intent. */
export function decideAgentTradePolicy(input: AgentTradeDecisionInput): AgentTradeDecision {
  if (!input || !validTime(input.nowMs) || !validPrincipal(input.principal) || !validBinding(input.intent) ||
    !sameBinding(input.principal, input.intent) ||
    !CLIENT_REQUEST_ID.test(input.intent.clientRequestId) ||
    !["BUY", "SELL"].includes(input.intent.side) ||
    !["STOCKS", "PRE_IPO"].includes(input.intent.market) ||
    !validAssetId(input.intent.market, input.intent.assetId) ||
    rawU64(input.intent.amountRaw) === null) return reject("INVALID_INTENT");
  if (!input.principal.scopes.includes(input.intent.side === "BUY" ? "trades:buy" : "trades:sell")) {
    return reject("SCOPE_NOT_GRANTED");
  }

  const policy = input.policy;
  if (!validBinding(policy) || !sameBinding(input.principal, policy)) return reject("IDENTITY_MISMATCH");
  if (!policy.active || !Number.isSafeInteger(policy.version) || policy.version < 1 ||
    !Number.isSafeInteger(input.expectedPolicyVersion) || input.expectedPolicyVersion < 1 ||
    !validTime(policy.expiresAtMs) ||
    !["DISABLED", "APPROVAL", "AUTO"].includes(policy.buyMode) ||
    !["DISABLED", "APPROVAL", "AUTO"].includes(policy.sellMode) ||
    typeof policy.autoTradingOwnerOptIn !== "boolean" || !Array.isArray(policy.allowedMarkets) ||
    policy.allowedMarkets.length > 2 ||
    policy.allowedMarkets.some((market) => market !== "STOCKS" && market !== "PRE_IPO") ||
    new Set(policy.allowedMarkets).size !== policy.allowedMarkets.length) return reject("POLICY_UNAVAILABLE");
  if (input.expectedPolicyVersion !== policy.version) return reject("POLICY_VERSION_MISMATCH");
  if (policy.expiresAtMs <= input.nowMs) return reject("POLICY_EXPIRED");
  if (!policy.allowedMarkets.includes(input.intent.market) ||
    !policy.assetRule || policy.assetRule.market !== input.intent.market ||
    policy.assetRule.assetId !== input.intent.assetId) return reject("ASSET_NOT_ALLOWED");

  const mode = input.intent.side === "BUY" ? policy.buyMode : policy.sellMode;
  if (mode === "DISABLED") return reject("MODE_DISABLED");
  const limit = input.intent.side === "BUY" ? policy.buyLimit : policy.assetRule.sellLimit;
  if (!validLimit(limit)) return reject("INVALID_LIMIT");
  if ((limit.perTradeRaw === null && !limit.unlimitedPerTradeOwnerOptIn) ||
    (limit.rolling24hRaw === null && !limit.unlimited24hOwnerOptIn)) return reject("UNBOUNDED_NOT_AUTHORIZED");
  const amount = rawU64(input.intent.amountRaw)!;
  if (limit.perTradeRaw !== null && amount > rawU64(limit.perTradeRaw)!) return reject("LIMIT_EXCEEDED");

  const usage = input.usage;
  if (!usage || usage.complete !== true || !validTime(usage.asOfMs) ||
    usage.asOfMs > input.nowMs || input.nowMs - usage.asOfMs > MAX_USAGE_AGE_MS ||
    !Array.isArray(usage.entries) || usage.entries.length > MAX_USAGE_ENTRIES) return reject("USAGE_UNAVAILABLE");
  let used = 0n;
  for (const entry of usage.entries) {
    const raw = entry && rawU64(entry.amountRaw);
    if (!entry || !validBinding(entry) || !sameBinding(input.principal, entry) ||
      (entry.side !== "BUY" && entry.side !== "SELL") ||
      (entry.status !== "RESERVED" && entry.status !== "FINALIZED") ||
      !validUsageAssetId(entry.assetId) || !validTime(entry.accountedAtMs) ||
      entry.accountedAtMs > input.nowMs || raw === null) return reject("USAGE_UNAVAILABLE");
    // BUY is bounded in USDC across both markets. SELL raw units are only
    // comparable within the same mint. Unresolved reservations never age out.
    if (entry.side === input.intent.side &&
      (entry.side === "BUY" || entry.assetId === input.intent.assetId) &&
      (entry.status === "RESERVED" || entry.accountedAtMs >= input.nowMs - DAY_MS)) used += raw;
  }
  if (limit.rolling24hRaw !== null && used + amount > rawU64(limit.rolling24hRaw)!) return reject("LIMIT_EXCEEDED");
  if (mode === "APPROVAL") return { decision: "APPROVAL_REQUIRED", policyVersion: policy.version };

  if (!policy.autoTradingOwnerOptIn) return reject("OWNER_OPT_IN_REQUIRED");
  const delegation = input.delegation;
  if (!delegation || !validBinding(delegation) || !sameBinding(input.principal, delegation) ||
    delegation.ready !== true || delegation.privyPolicyReady !== true ||
    typeof delegation.walletId !== "string" || delegation.walletId.length < 3 ||
    !validTime(delegation.verifiedAtMs) || delegation.verifiedAtMs > input.nowMs ||
    input.nowMs - delegation.verifiedAtMs > MAX_USAGE_AGE_MS ||
    !validTime(delegation.expiresAtMs) || delegation.expiresAtMs <= input.nowMs) {
    return reject("DELEGATION_NOT_READY");
  }
  return { decision: "AUTO_ALLOWED", policyVersion: policy.version };
}
