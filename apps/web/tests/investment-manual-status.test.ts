import assert from "node:assert/strict";
import test from "node:test";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { AUTH_SESSION_COOKIE } from "../lib/auth/config";
import { createAuthSession, encodeAuthSession, registerAuthSession } from "../lib/auth/session";
import type { ManualBuyExecutionRecord } from "../lib/control-plane/manual-executions";
import {
  readManualBuyStatus,
  readRecoverableManualTradeStatus,
  type ManualBuyStatusDependencies,
} from "../lib/investments/manual-status";
import { SolanaBuyReconciliationError } from "../lib/investments/reconciliation";
import { createManualStatusPost, POST as statusRoute } from "../app/api/investments/manual/status/route";

const owner = { privyUserId: "did:privy:status-owner", walletAddress: "11111111111111111111111111111111" };
const record: ManualBuyExecutionRecord = {
  id: "claim-id", accountId: owner.privyUserId, walletAddress: owner.walletAddress,
  providerRequestId: "one-claimed-buy", transactionSignature: "1".repeat(88),
    messageFingerprint: "a".repeat(43), inputMint: SOLANA_MAINNET_USDC_MINT,
    side: "BUY", inputDecimals: 6,
  outputMint: "So11111111111111111111111111111111111111112", outputDecimals: 9,
  inputAmountRaw: "1000000", requiredMinimumOutputRaw: "100000",
  maximumWalletNativeDebitLamportsRaw: "2000000",
  expiresAt: "2020-01-01T00:00:00.000Z", status: "UNKNOWN",
  createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
  submittedAt: null, resolvedAt: null, actualInputAmountRaw: null,
  actualOutputAmountRaw: null, actualWalletNativeDebitLamportsRaw: null,
};

function dependencies(overrides: Partial<ManualBuyStatusDependencies> = {}): ManualBuyStatusDependencies {
  return {
    getExecution: async () => record,
    reconcileOnChain: async () => ({ status: "PENDING" }),
    settleExecution: async () => { throw new Error("unexpected settlement"); },
    ...overrides,
  };
}

test("status reads only the session owner's claim and immutable ledger terms, even after quote expiry", async () => {
  let lookup: unknown;
  let chainInput: unknown;
  const result = await readManualBuyStatus(owner, record.providerRequestId, dependencies({
    getExecution: async (key) => { lookup = key; return record; },
    reconcileOnChain: async (input) => { chainInput = input; return { status: "PENDING" }; },
  }));
  assert.deepEqual(lookup, { accountId: owner.privyUserId, walletAddress: owner.walletAddress,
    providerRequestId: record.providerRequestId });
  assert.deepEqual(chainInput, {
    side: "BUY", signature: record.transactionSignature, walletAddress: record.walletAddress,
    inputMint: record.inputMint, outputMint: record.outputMint,
    inputDecimals: 6, outputDecimals: 9, expectedInputAmountRaw: "1000000",
    requiredMinimumOutputRaw: "100000", maximumWalletNativeDebitLamportsRaw: "2000000",
  });
  assert.equal(result?.status, "UNKNOWN");
  assert.equal(result?.ledgerStatus, "UNKNOWN");
});

test("SELL status reconciles the immutable token to USDC direction", async () => {
  const sell = { ...record, side: "SELL" as const,
    inputMint: record.outputMint, inputDecimals: 9,
    outputMint: SOLANA_MAINNET_USDC_MINT, outputDecimals: 6 };
  let chainInput: unknown;
  const result = await readManualBuyStatus(owner, sell.providerRequestId, dependencies({
    getExecution: async () => sell,
    reconcileOnChain: async (value) => { chainInput = value; return { status: "PENDING" }; },
  }));
  assert.equal(result?.side, "SELL");
  assert.deepEqual(chainInput, {
    side: "SELL", signature: sell.transactionSignature, walletAddress: sell.walletAddress,
    inputMint: sell.inputMint, outputMint: sell.outputMint, inputDecimals: 9,
    outputDecimals: 6, expectedInputAmountRaw: sell.inputAmountRaw,
    requiredMinimumOutputRaw: sell.requiredMinimumOutputRaw,
    maximumWalletNativeDebitLamportsRaw: sell.maximumWalletNativeDebitLamportsRaw,
  });
});

test("absent or terminal owner records cause no chain read and no resubmission", async () => {
  let calls = 0;
  const deps = dependencies({
    getExecution: async () => null,
    reconcileOnChain: async () => { calls++; return { status: "PENDING" }; },
  });
  assert.equal(await readManualBuyStatus(owner, "missing", deps), null);
  assert.equal(calls, 0);
  deps.getExecution = async () => ({ ...record, status: "CONFIRMED", actualInputAmountRaw: "1000000",
    actualOutputAmountRaw: "150000", actualWalletNativeDebitLamportsRaw: "100000" });
  assert.equal((await readManualBuyStatus(owner, record.providerRequestId, deps))?.status, "CONFIRMED");
  deps.getExecution = async () => ({ ...record, status: "REJECTED" });
  assert.equal((await readManualBuyStatus(owner, record.providerRequestId, deps))?.status, "REJECTED");
  assert.equal(calls, 0);
});

test("active-trade recovery uses the verified owner and preserves unresolved status", async () => {
  let lookup: unknown;
  const recovered = await readRecoverableManualTradeStatus(owner, async (key) => {
    lookup = key;
    return record;
  }, dependencies());
  assert.deepEqual(lookup, { accountId: owner.privyUserId, walletAddress: owner.walletAddress });
  assert.equal(recovered?.providerRequestId, record.providerRequestId);
  assert.equal(recovered?.status, "UNKNOWN");
  assert.equal(await readRecoverableManualTradeStatus(owner, async () => null, dependencies()), null);
});

test("a mismatched ledger record never reaches chain reconciliation", async () => {
  let chainCalls = 0;
  await assert.rejects(readManualBuyStatus(owner, record.providerRequestId, dependencies({
    getExecution: async () => ({ ...record, accountId: "did:privy:somebody-else" }),
    reconcileOnChain: async () => { chainCalls++; return { status: "PENDING" }; },
  })));
  assert.equal(chainCalls, 0);
});

test("only finalized reconciler evidence advances a pending claim", async () => {
  let settlement: unknown;
  const deps = dependencies({
    reconcileOnChain: async () => ({ status: "CONFIRMED", slot: 77, actualInputAmountRaw: "1000000",
      actualOutputAmountRaw: "150000", actualWalletNativeDebitLamportsRaw: "100000" }),
    settleExecution: async (input) => {
      settlement = input;
      return { ...record, status: "CONFIRMED", actualInputAmountRaw: input.actualInputAmountRaw ?? null,
        actualOutputAmountRaw: input.actualOutputAmountRaw ?? null,
        actualWalletNativeDebitLamportsRaw: input.actualWalletNativeDebitLamportsRaw ?? null };
    },
  });
  const result = await readManualBuyStatus(owner, record.providerRequestId, deps);
  assert.deepEqual(settlement, {
    accountId: record.accountId, walletAddress: record.walletAddress,
    providerRequestId: record.providerRequestId, transactionSignature: record.transactionSignature,
    outcome: "CONFIRMED", actualInputAmountRaw: "1000000", actualOutputAmountRaw: "150000",
    actualWalletNativeDebitLamportsRaw: "100000",
  });
  assert.equal(result?.status, "CONFIRMED");
  assert.equal(result?.actualOutputAmountRaw, "150000");
});

test("finalized transaction failure can settle FAILED, but unverifiable or below-minimum output cannot", async () => {
  let settlement: unknown;
  const failed = await readManualBuyStatus(owner, record.providerRequestId, dependencies({
    reconcileOnChain: async () => ({ status: "FAILED", slot: 77 }),
    settleExecution: async (input) => { settlement = input; return { ...record, status: "FAILED" }; },
  }));
  assert.equal(failed?.status, "FAILED");
  assert.deepEqual(settlement, {
    accountId: record.accountId, walletAddress: record.walletAddress,
    providerRequestId: record.providerRequestId, transactionSignature: record.transactionSignature,
    outcome: "FAILED",
  });
  settlement = null;
  const belowMinimum = await readManualBuyStatus(owner, record.providerRequestId, dependencies({
    reconcileOnChain: async () => ({ status: "CONFIRMED", slot: 77, actualInputAmountRaw: "1000000",
      actualOutputAmountRaw: "99999", actualWalletNativeDebitLamportsRaw: "100000" }),
    settleExecution: async (input) => { settlement = input; throw new Error("must not settle"); },
  }));
  assert.equal(belowMinimum?.status, "REVIEW_REQUIRED");
  assert.equal(belowMinimum?.ledgerStatus, "UNKNOWN");
  assert.equal(settlement, null);
  const excessiveNative = await readManualBuyStatus(owner, record.providerRequestId, dependencies({
    reconcileOnChain: async () => ({ status: "CONFIRMED", slot: 77, actualInputAmountRaw: "1000000",
      actualOutputAmountRaw: "150000", actualWalletNativeDebitLamportsRaw: "2000001" }),
  }));
  assert.equal(excessiveNative?.status, "REVIEW_REQUIRED");
  const unverifiable = await readManualBuyStatus(owner, record.providerRequestId, dependencies({
    reconcileOnChain: async () => { throw new SolanaBuyReconciliationError(); },
  }));
  assert.equal(unverifiable?.status, "REVIEW_REQUIRED");
});

process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";
process.env.AUTH_ENABLED = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "manual-status-route-secret-at-least-32-bytes";

async function request(body: unknown, origin: string | null = "http://localhost:3000"): Promise<Request> {
  const session = createAuthSession(owner.walletAddress, Date.now(), owner.privyUserId, Date.now() + 40_000);
  await registerAuthSession(session);
  const token = await encodeAuthSession(session, process.env.SESSION_SECRET!);
  return new Request("http://localhost:3000/api/investments/manual/status", {
    method: "POST", headers: {
      "content-type": "application/json", cookie: `${AUTH_SESSION_COOKIE}=${token}`,
      ...(origin === null ? {} : { origin }),
    }, body: JSON.stringify(body),
  });
}

test("status route requires a Privy session and same-origin POST; caller cannot choose execution identity", async () => {
  const unauthenticated = await statusRoute(new Request("http://localhost:3000/api/investments/manual/status", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ providerRequestId: record.providerRequestId }),
  }));
  assert.equal(unauthenticated.status, 401);
  assert.equal((await statusRoute(await request({ providerRequestId: record.providerRequestId }, null))).status, 403);
  assert.equal((await statusRoute(await request({ providerRequestId: record.providerRequestId }, "https://evil.example"))).status, 403);
  for (const extra of ["accountId", "walletAddress", "transactionSignature",
    "requiredMinimumOutputRaw", "maximumWalletNativeDebitLamportsRaw"]) {
    const response = await statusRoute(await request({ providerRequestId: record.providerRequestId, [extra]: "attacker" }));
    assert.equal(response.status, 400, extra);
  }
  assert.equal((await statusRoute(await request({ active: false }))).status, 400);
  assert.equal((await statusRoute(await request({ active: true, walletAddress: owner.walletAddress }))).status, 400);
});

test("status route recovers a recent order using the session owner only", async () => {
  let lookupOwner: unknown;
  const post = createManualStatusPost({
    async recover(identity) {
      lookupOwner = identity;
      return { side: "BUY", providerRequestId: record.providerRequestId,
        transactionSignature: record.transactionSignature, status: "UNKNOWN", ledgerStatus: "UNKNOWN",
        actualInputAmountRaw: null, actualOutputAmountRaw: null,
        actualWalletNativeDebitLamportsRaw: null };
    },
  });
  const response = await post(await request({ active: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(lookupOwner, owner);
  const body = await response.json() as { execution: { providerRequestId: string; status: string } };
  assert.equal(body.execution.providerRequestId, record.providerRequestId);
  assert.equal(body.execution.status, "UNKNOWN");
});
