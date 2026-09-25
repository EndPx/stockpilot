import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAgentTradePolicy,
  type AgentTradeDecisionInput,
  type AgentTradeUsageEntry,
} from "@stockpilot/core/agent-trade-policy";

const now = Date.parse("2026-09-25T12:00:00.000Z");
const mint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const walletAddress = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const stock = `xstocks:${mint}`;
const preIpo = `prestocks:${mint}`;
const accountId = "did:privy:fixture-user";
const clientId = "e9c28e8d-f83b-436d-a1c3-cad5d832304a";
const key = "fixture_request_0001";

function fixture(): AgentTradeDecisionInput {
  const principal = { accountId, clientId, walletAddress, scopes: ["trades:buy", "trades:sell"] };
  return {
    nowMs: now,
    principal,
    intent: { ...principal, clientRequestId: key, side: "BUY", market: "STOCKS", assetId: stock, amountRaw: "50000000" },
    policy: {
      ...principal, active: true, version: 3, expiresAtMs: now + 60_000,
      buyMode: "AUTO", sellMode: "AUTO", autoTradingOwnerOptIn: true,
      allowedMarkets: ["STOCKS", "PRE_IPO"],
      buyLimit: { perTradeRaw: "50000000", rolling24hRaw: "100000000",
        unlimitedPerTradeOwnerOptIn: false, unlimited24hOwnerOptIn: false },
      assetRule: { market: "STOCKS", assetId: stock,
        sellLimit: { perTradeRaw: "100", rolling24hRaw: "200",
          unlimitedPerTradeOwnerOptIn: false, unlimited24hOwnerOptIn: false } },
    },
    delegation: { ...principal, ready: true, walletId: "wal_fixture", privyPolicyReady: true,
      verifiedAtMs: now, expiresAtMs: now + 60_000 },
    usage: { complete: true, asOfMs: now, entries: [] },
    expectedPolicyVersion: 3,
  };
}

function entry(input: AgentTradeDecisionInput, overrides: Partial<AgentTradeUsageEntry> = {}): AgentTradeUsageEntry {
  return { ...input.principal, side: input.intent.side, assetId: input.intent.assetId,
    amountRaw: "1", status: "RESERVED", accountedAtMs: now, ...overrides };
}

function rejected(input: AgentTradeDecisionInput, reason: string): void {
  assert.deepEqual(decideAgentTradePolicy(input), { decision: "REJECTED", reason });
}

test("AUTO BUY is limited and owner-delegated for both canonical markets", () => {
  const input = fixture();
  assert.deepEqual(decideAgentTradePolicy(input), { decision: "AUTO_ALLOWED", policyVersion: 3 });
  input.intent.market = "PRE_IPO";
  input.intent.assetId = preIpo;
  input.policy.assetRule = { ...input.policy.assetRule!, market: "PRE_IPO", assetId: preIpo };
  assert.deepEqual(decideAgentTradePolicy(input), { decision: "AUTO_ALLOWED", policyVersion: 3 });
});

test("SELL has a separate mode and raw-token-unit limits", () => {
  const input = fixture();
  input.intent.side = "SELL";
  input.intent.amountRaw = "100";
  assert.deepEqual(decideAgentTradePolicy(input), { decision: "AUTO_ALLOWED", policyVersion: 3 });
  input.intent.amountRaw = "101";
  rejected(input, "LIMIT_EXCEEDED");
  input.policy.sellMode = "DISABLED";
  rejected(input, "MODE_DISABLED");
});

test("APPROVAL does not pretend to have delegated signing authority", () => {
  const input = fixture();
  input.policy.buyMode = "APPROVAL";
  input.policy.autoTradingOwnerOptIn = false;
  input.delegation = null;
  assert.deepEqual(decideAgentTradePolicy(input), { decision: "APPROVAL_REQUIRED", policyVersion: 3 });
  input.intent.side = "SELL";
  input.intent.amountRaw = "10";
  input.policy.sellMode = "APPROVAL";
  assert.deepEqual(decideAgentTradePolicy(input), { decision: "APPROVAL_REQUIRED", policyVersion: 3 });
});

test("DISABLED is a denial, not an implicit request to approve", () => {
  const input = fixture();
  input.policy.buyMode = "DISABLED";
  rejected(input, "MODE_DISABLED");
});

test("a server-verified side-specific trade scope is required in addition to AUTO mode", () => {
  const buy = fixture();
  buy.principal.scopes = ["trades:sell"];
  rejected(buy, "SCOPE_NOT_GRANTED");
  const sell = fixture();
  sell.intent.side = "SELL";
  sell.intent.amountRaw = "10";
  sell.principal.scopes = ["trades:buy"];
  rejected(sell, "SCOPE_NOT_GRANTED");
  const approval = fixture();
  approval.policy.buyMode = "APPROVAL";
  approval.principal.scopes = [];
  rejected(approval, "SCOPE_NOT_GRANTED");
});

test("intent, policy, and delegation must all be bound to the same owner, client, and wallet", () => {
  const intent = fixture();
  intent.intent.clientId = "other-client";
  rejected(intent, "INVALID_INTENT");
  const policy = fixture();
  policy.policy.accountId = "did:privy:other-user";
  rejected(policy, "IDENTITY_MISMATCH");
  const delegation = fixture();
  delegation.delegation!.walletAddress = mint;
  rejected(delegation, "DELEGATION_NOT_READY");
});

test("unknown or mismatched market/asset is denied even when mode is AUTO", () => {
  const wrongPrefix = fixture();
  wrongPrefix.intent.assetId = preIpo;
  rejected(wrongPrefix, "INVALID_INTENT");
  const market = fixture();
  market.policy.allowedMarkets = ["PRE_IPO"];
  rejected(market, "ASSET_NOT_ALLOWED");
  const asset = fixture();
  asset.policy.assetRule!.assetId = preIpo;
  rejected(asset, "ASSET_NOT_ALLOWED");
  const noRule = fixture();
  noRule.policy.assetRule = null;
  rejected(noRule, "ASSET_NOT_ALLOWED");
});

test("policy version, activity, and expiry fail closed", () => {
  const changed = fixture();
  changed.expectedPolicyVersion = 2;
  rejected(changed, "POLICY_VERSION_MISMATCH");
  const inactive = fixture();
  inactive.policy.active = false;
  rejected(inactive, "POLICY_UNAVAILABLE");
  const expired = fixture();
  expired.policy.expiresAtMs = now;
  rejected(expired, "POLICY_EXPIRED");
});

test("AUTO needs explicit owner opt-in and fresh delegated signing readiness", () => {
  const owner = fixture();
  owner.policy.autoTradingOwnerOptIn = false;
  rejected(owner, "OWNER_OPT_IN_REQUIRED");
  const missing = fixture();
  missing.delegation = null;
  rejected(missing, "DELEGATION_NOT_READY");
  const policy = fixture();
  policy.delegation!.privyPolicyReady = false;
  rejected(policy, "DELEGATION_NOT_READY");
  const stale = fixture();
  stale.delegation!.verifiedAtMs = now - 5_001;
  rejected(stale, "DELEGATION_NOT_READY");
  const expired = fixture();
  expired.delegation!.expiresAtMs = now;
  rejected(expired, "DELEGATION_NOT_READY");
});

test("a missing cap never means unlimited without the matching owner opt-in", () => {
  const perTrade = fixture();
  perTrade.policy.buyLimit.perTradeRaw = null;
  rejected(perTrade, "UNBOUNDED_NOT_AUTHORIZED");
  perTrade.policy.buyLimit.unlimitedPerTradeOwnerOptIn = true;
  assert.equal(decideAgentTradePolicy(perTrade).decision, "AUTO_ALLOWED");
  const daily = fixture();
  daily.policy.buyLimit.rolling24hRaw = null;
  rejected(daily, "UNBOUNDED_NOT_AUTHORIZED");
  daily.policy.buyLimit.unlimited24hOwnerOptIn = true;
  assert.equal(decideAgentTradePolicy(daily).decision, "AUTO_ALLOWED");
});

test("malformed, zero, and oversized raw amounts or limits are rejected", () => {
  for (const amountRaw of ["0", "01", "1.5", "-1", "18446744073709551616"]) {
    const input = fixture();
    input.intent.amountRaw = amountRaw;
    rejected(input, "INVALID_INTENT");
  }
  const limit = fixture();
  limit.policy.buyLimit.perTradeRaw = "0";
  rejected(limit, "INVALID_LIMIT");
  const keyInput = fixture();
  keyInput.intent.clientRequestId = "short";
  rejected(keyInput, "INVALID_INTENT");
});

test("rolling BUY cap includes finalized spend and unresolved reservations across markets", () => {
  const input = fixture();
  input.intent.amountRaw = "20000001";
  input.usage.entries = [
    entry(input, { side: "BUY", assetId: stock, amountRaw: "30000000", status: "FINALIZED" }),
    entry(input, { side: "BUY", assetId: preIpo, amountRaw: "50000000", status: "RESERVED" }),
  ];
  rejected(input, "LIMIT_EXCEEDED");
  input.intent.amountRaw = "20000000";
  assert.equal(decideAgentTradePolicy(input).decision, "AUTO_ALLOWED");
});

test("rolling SELL cap sums only the same asset's raw units", () => {
  const input = fixture();
  input.intent.side = "SELL";
  input.intent.amountRaw = "51";
  input.usage.entries = [
    entry(input, { side: "SELL", amountRaw: "150", status: "FINALIZED" }),
    entry(input, { side: "SELL", assetId: `xstocks:${walletAddress}`, amountRaw: "150", status: "FINALIZED" }),
  ];
  rejected(input, "LIMIT_EXCEEDED");
  input.intent.amountRaw = "50";
  assert.equal(decideAgentTradePolicy(input).decision, "AUTO_ALLOWED");
});

test("finalized spend expires after 24h, but unresolved reservations do not", () => {
  const input = fixture();
  input.intent.amountRaw = "50000000";
  input.usage.entries = [entry(input, { amountRaw: "50000001", status: "FINALIZED", accountedAtMs: now - 86_400_001 })];
  assert.equal(decideAgentTradePolicy(input).decision, "AUTO_ALLOWED");
  input.usage.entries = [entry(input, { amountRaw: "50000001", status: "FINALIZED", accountedAtMs: now - 86_400_000 })];
  rejected(input, "LIMIT_EXCEEDED");
  input.usage.entries = [entry(input, { amountRaw: "50000001", status: "RESERVED", accountedAtMs: now - 86_400_001 })];
  rejected(input, "LIMIT_EXCEEDED");
});

test("usage must be complete, current, valid, and tenant-bound", () => {
  const incomplete = fixture();
  incomplete.usage.complete = false;
  rejected(incomplete, "USAGE_UNAVAILABLE");
  const stale = fixture();
  stale.usage.asOfMs = now - 5_001;
  rejected(stale, "USAGE_UNAVAILABLE");
  const otherTenant = fixture();
  otherTenant.usage.entries = [entry(otherTenant, { accountId: "did:privy:other-user" })];
  rejected(otherTenant, "USAGE_UNAVAILABLE");
  const future = fixture();
  future.usage.entries = [entry(future, { accountedAtMs: now + 1 })];
  rejected(future, "USAGE_UNAVAILABLE");
  const oversized = fixture();
  oversized.usage.entries = Array.from({ length: 4_097 }, () => entry(oversized));
  rejected(oversized, "USAGE_UNAVAILABLE");
});

test("a new reservation must enter the next locked snapshot before any competing decision", () => {
  const first = fixture();
  first.intent.amountRaw = "50000000";
  assert.equal(decideAgentTradePolicy(first).decision, "AUTO_ALLOWED");
  const second = fixture();
  second.intent.clientRequestId = "fixture_request_0002";
  second.intent.amountRaw = "50000001";
  second.usage.entries = [entry(first, { amountRaw: first.intent.amountRaw })];
  rejected(second, "LIMIT_EXCEEDED");
  // The module cannot serialize the two evaluations. The future gateway must
  // lock and persist first's reservation before evaluating second.
});

test("policy evaluation is pure", () => {
  const input = fixture();
  const before = structuredClone(input);
  decideAgentTradePolicy(input);
  assert.deepEqual(input, before);
});
