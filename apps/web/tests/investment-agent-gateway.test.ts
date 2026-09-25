import assert from "node:assert/strict";
import test from "node:test";
import { createAgentExecutionGateway, agentOperationIntent, publicAgentOperation } from "../lib/agent-execution/gateway";
import type { AgentOperationRecord } from "../lib/control-plane/agent-operations";
import type { AgentPrincipal } from "../lib/control-plane/credentials";
import type { PreparedTransfer } from "../lib/investments/transfer";

const principal: AgentPrincipal = { accountId: "did:privy:owner", clientId: "c241df90-864e-471a-8d22-5ab390357f76",
  walletAddress: "6EuMFHPtiyoFtsBTy1hiJpNgupP7qkZfZm9ErQ58ipsC", scopes: ["markets:read"],
  authMethod: "oauth", credentialId: null, oauthIssuer: "https://example.authkit.app", oauthSubject: "owner", oauthClientId: "client" };
const recipient = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const now = Date.now();
const request = { kind: "TRANSFER_SOL" as const, amount: "0.001", recipient, clientRequestId: "test_transfer_0001" };
const signature = "5".repeat(88);
const prepared: PreparedTransfer = { kind: "SOL", walletAddress: principal.walletAddress, recipient,
  inputAmountRaw: "1000000", mint: null, decimals: 9, transaction: "unsigned-test-wire",
  requestId: `build:${"a".repeat(64)}`, expiresAt: new Date(now + 60_000).toISOString(),
  lastValidBlockHeight: "100", blockhash: "2".repeat(32), messageFingerprint: "a".repeat(43),
  networkFeeLamportsRaw: "5000", accountRentLamportsRaw: "0", maximumNativeDebitLamportsRaw: "1005000",
  sourceTokenAccount: null, destinationAccount: recipient, createDestinationAta: false };

function fixture(overrides: NonNullable<Parameters<typeof createAgentExecutionGateway>[0]> = {}) {
  const calls: string[] = [];
  let record: AgentOperationRecord | undefined;
  const update = (status: AgentOperationRecord["status"]) => { record = { ...record!, status }; return record; };
  const gateway = createAgentExecutionGateway({
    enabled: () => true, now: () => now,
    reserve: async (caller, intent) => {
      calls.push("reserve"); assert.equal(caller, principal);
      if (record) return { created: false, operation: record };
      record = { id: "f4d0b0d0-665a-42f1-8f37-d181356f24f0", accountId: caller.accountId,
        clientId: caller.clientId, walletAddress: caller.walletAddress, ...intent,
        recipient: intent.recipient ?? null, assetId: intent.assetId ?? null,
        intentHash: "hash", policyVersion: 2, status: "RESERVED", providerRequestId: null,
        messageFingerprint: null, transactionSignature: null, preparedContext: null,
        actualInputAmountRaw: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
        submittedAt: null, resolvedAt: null, expiresAt: null };
      return { created: true, operation: record };
    },
    readiness: async () => ({ configured: true, enabled: true, ready: true, signerId: "signer", policyId: "policy", reason: "READY" }),
    prepareTransfer: async () => { calls.push("prepare"); return prepared; },
    assertTransfer: async () => { calls.push("verify"); },
    fingerprint: async () => prepared.messageFingerprint,
    beginSigning: async (_caller, _id, input) => {
      calls.push("claim-sign"); record = { ...record!, ...input };
      return { claimed: true, operation: update("SIGNING") };
    },
    sign: async (owner, input) => {
      calls.push("sign"); assert.equal(owner.privyUserId, principal.accountId);
      assert.equal(input.transaction, prepared.transaction); return "signed-wire-never-return";
    },
    assertSigned: async () => { calls.push("verify-signature"); }, signature: () => signature,
    recordSigned: async (_caller, _id, input) => {
      calls.push("persist-signature"); record = { ...record!, ...input }; return update("SIGNED");
    },
    blockHeight: async () => 90n,
    beginSubmission: async () => { calls.push("claim-send"); return { claimed: true, operation: update("SUBMITTED") }; },
    execute: async () => { calls.push("send"); return { status: "Success", signature, code: null, error: null,
      totalInputAmount: null, totalOutputAmount: null }; },
    reject: async () => { calls.push("reject"); return update("REJECTED"); },
    cancelReserved: async () => { calls.push("reject"); return update("REJECTED"); },
    rejectUnsubmitted: async () => { calls.push("reject-unsubmitted"); return update("REJECTED"); },
    unknown: async () => { calls.push("unknown"); return update("UNKNOWN"); },
    readTransfer: async () => { calls.push("read-chain"); return { status: "PENDING" }; },
    readExpiry: async () => null,
    reconcile: async (_caller, _id, result) => { calls.push("settle"); return update(result.outcome); },
    get: async () => record!, list: async () => record ? [record] : [],
    ...overrides,
  });
  return { gateway, calls, getRecord: () => record! };
}

test("agent transfer claims budget, persists signature and claims send before the only RPC submission", async () => {
  const { gateway, calls } = fixture();
  const result = await gateway.execute(principal, request);
  assert.equal(result.status, "SUBMITTED");
  assert.deepEqual(calls, ["reserve", "prepare", "verify", "claim-sign", "sign", "verify-signature", "persist-signature", "claim-send", "send", "read-chain"]);
  assert.doesNotMatch(JSON.stringify(result), /signed-wire|unsigned-test-wire|preparedContext|accountId|oauthSubject/);
  await gateway.execute(principal, request);
  assert.equal(calls.filter((item) => item === "send").length, 1);
  assert.equal(calls.filter((item) => item === "sign").length, 1);
});

test("lost submission response stays UNKNOWN and a duplicate never signs or sends again", async () => {
  let sends = 0;
  const { gateway, calls } = fixture({ execute: async () => { sends++; throw new Error("timeout"); } });
  assert.equal((await gateway.execute(principal, request)).status, "UNKNOWN");
  assert.equal((await gateway.execute(principal, request)).status, "UNKNOWN");
  assert.equal(sends, 1); assert.equal(calls.filter((item) => item === "sign").length, 1);
});

test("wallet consent missing rejects untouched reservation without signing", async () => {
  const { gateway, calls } = fixture({ readiness: async () => ({ configured: true, enabled: true,
    ready: false, signerId: "s", policyId: "p", reason: "OWNER_CONSENT_REQUIRED" }) });
  await assert.rejects(gateway.execute(principal, request), /OWNER_CONSENT_REQUIRED/);
  assert.deepEqual(calls, ["reserve", "reject"]);
});

test("a changed policy at submission fence prevents all network submission", async () => {
  const { gateway, calls } = fixture({ beginSubmission: async () => { throw new Error("policy changed"); } });
  assert.equal((await gateway.execute(principal, request)).status, "UNKNOWN");
  assert.equal(calls.includes("send"), false);
});

test("a lost signing response is not safe to sign again", async () => {
  let signs = 0;
  const { gateway, calls } = fixture({ sign: async () => { signs++; throw new Error("timeout"); } });
  assert.equal((await gateway.execute(principal, request)).status, "UNKNOWN");
  await gateway.execute(principal, request);
  assert.equal(signs, 1); assert.equal(calls.includes("send"), false);
});

test("expired or unavailable readiness before the send fence safely rejects without broadcasting", async () => {
  const { gateway, calls } = fixture({ blockHeight: async () => 101n });
  assert.equal((await gateway.execute(principal, request)).status, "REJECTED");
  assert.equal(calls.includes("reject-unsubmitted"), true);
  assert.equal(calls.includes("claim-send"), false);
  assert.equal(calls.includes("send"), false);
  await gateway.execute(principal, request);
  assert.equal(calls.filter((item) => item === "sign").length, 1);
});

test("kill switch and denied durable reservation do not reach any signing code", async () => {
  const disabled = fixture({ enabled: () => false });
  await assert.rejects(disabled.gateway.execute(principal, request), /EXECUTION_DISABLED/);
  assert.deepEqual(disabled.calls, []);
  const denied = fixture({ reserve: async () => { throw new Error("POLICY_DISABLED"); } });
  await assert.rejects(denied.gateway.execute(principal, request), /POLICY_DISABLED/);
  assert.deepEqual(denied.calls, []);
});

test("RPC preflight rejection is distinguished from timeout and finalized success", async () => {
  const rejected = fixture({ execute: async () => ({ status: "Rejected", code: -32002 }) });
  assert.equal((await rejected.gateway.execute(principal, request)).status, "REJECTED");
  const confirmed = fixture({ readTransfer: async () => ({ status: "CONFIRMED", slot: 1,
    actualInputAmountRaw: "1000000", actualOutputAmountRaw: "1000000", actualNativeDebitLamportsRaw: "1005000" }) });
  assert.equal((await confirmed.gateway.execute(principal, request)).status, "CONFIRMED");
  assert.doesNotMatch(JSON.stringify(publicAgentOperation(confirmed.getRecord())), /transaction|signer/i);
});

test("expired operations reconcile without signing or sending a replacement, including list refresh", async () => {
  let allowExpiry = false;
  const f = fixture({ readExpiry: async operation => allowExpiry ? {
    operationId: operation.id, signature, messageFingerprint: prepared.messageFingerprint,
    blockhash: prepared.blockhash, lastValidBlockHeight: "100", observedAt: new Date(now).toISOString(), witnesses: [],
  } : null });
  assert.equal((await f.gateway.execute(principal, request)).status, "SUBMITTED");
  allowExpiry = true;
  assert.equal((await f.gateway.list(principal)).operations[0].status, "EXPIRED");
  const repeated = await f.gateway.execute(principal, request);
  assert.equal(repeated.status, "EXPIRED");
  assert.match(repeated.note!, /new explicit request/);
  assert.equal(f.calls.filter(c => c === "send").length, 1);
  assert.equal(f.calls.filter(c => c === "sign").length, 1);
  assert.equal(f.calls.filter(c => c === "settle").length, 1);
});

test("strict receipt verifier errors cannot fall back to expiry or release funds", async () => {
  let expiryReads = 0;
  const f = fixture({ readTransfer: async () => { throw new Error("unexpected transaction effects"); },
    readExpiry: async () => { expiryReads++; return null; } });
  assert.equal((await f.gateway.execute(principal, request)).status, "SUBMITTED");
  assert.equal(expiryReads, 0);
  assert.equal(f.calls.includes("settle"), false);
});

test("intent uses exact decimal amounts with no hardcoded test cap and never treats scaled shares as raw units", () => {
  assert.equal(agentOperationIntent({ ...request, amount: "12.345678901" }).amountRaw, "12345678901");
  assert.equal(agentOperationIntent({ kind: "BUY", amount: "100.123456", clientRequestId: request.clientRequestId,
    assetId: "xstocks:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" }).amountRaw, "100123456");
  assert.throws(() => agentOperationIntent({ ...request, amount: "0.0000000001" }));
  assert.throws(() => agentOperationIntent({ kind: "SELL", amount: "1", clientRequestId: request.clientRequestId,
    assetId: "xstocks:So11111111111111111111111111111111111111112" }), /ASSET_NOT_ALLOWED/);
});
