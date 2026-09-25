import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { address, appendTransactionMessageInstruction, compileTransaction, createTransactionMessage,
  getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash } from "@solana/kit";
import { readAgentOperationExpiry, assertAgentExpiryEvidence, type ExpiryCandidate } from "../lib/agent-execution/expiry";

const now = Date.now();
const wallet = "6EuMFHPtiyoFtsBTy1hiJpNgupP7qkZfZm9ErQ58ipsC";
const signature = "3".repeat(88);
const prior = "4".repeat(88);
const urls = ["https://rpc-a.test/secret", "https://rpc-b.test/secret"];
function candidate(nonce = false): ExpiryCandidate {
  const tx = compileTransaction(pipe(createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayer(address(wallet), m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: wallet as Blockhash, lastValidBlockHeight: 100n }, m),
    m => appendTransactionMessageInstruction({ programAddress: address(nonce ? "11111111111111111111111111111111" :
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), data: new Uint8Array(nonce ? [4, 0, 0, 0] : [1]) }, m)));
  return { id: "operation", status: "SUBMITTED", walletAddress: wallet,
    submittedAt: new Date(now - 280_000).toISOString(),
    createdAt: new Date(now - 300_000).toISOString(), transactionSignature: signature,
    messageFingerprint: createHash("sha256").update(Uint8Array.from(tx.messageBytes)).digest("base64url"),
    preparedContext: { transaction: Buffer.from(getTransactionEncoder().encode(tx)).toString("base64"), lastValidBlockHeight: "100" } };
}
type Override = (method: string, params: unknown[], url: string, value: unknown) => unknown;
function fixture(override: Override = (_m, _p, _u, value) => value) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    calls.push(method);
    const values: Record<string, unknown> = {
      getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      getSlot: 200, getBlockTime: Math.floor(now / 1000), getBlockHeight: 110,
      isBlockhashValid: { context: { slot: 201 }, value: false },
      getSignatureStatuses: { context: { slot: 201 }, value: [null] },
      getTransaction: params[0] === signature ? null : { slot: 50, blockTime: Math.floor((now - 600_000) / 1000), meta: { err: null },
        transaction: { signatures: [prior], message: { accountKeys: [{ pubkey: wallet }] } } },
      getSignaturesForAddress: [{ signature: prior, slot: 50, blockTime: Math.floor((now - 600_000) / 1000), err: null }],
    };
    return Response.json({ jsonrpc: "2.0", id, result: override(method, params, String(url), values[method]) });
  };
  return { calls, read: (input = candidate(), rpcUrls = urls) => readAgentOperationExpiry(input, { now: () => now, rpcUrls, fetcher }) };
}

test("expiry requires two mainnet witnesses, expired finalized lifetime and positive historical coverage", async () => {
  const f = fixture();
  const evidence = await f.read();
  assert.equal(evidence?.signature, signature);
  assert.equal(evidence?.messageFingerprint, candidate().messageFingerprint);
  assert.equal(evidence?.witnesses.length, 2);
  assert.equal(evidence?.witnesses[0].historyAnchorSignature, prior);
  assert.doesNotMatch(JSON.stringify(evidence), /secret|transactionBytes|token/i);
  assert.ok(f.calls.every(m => !/send|signTransaction|simulate/.test(m)));
  assert.throws(() => assertAgentExpiryEvidence({ ...candidate(), submittedAt: new Date(now - 1_000).toISOString() }, evidence!, now));
  for (const host of [null, undefined, 123]) {
    const invalid = JSON.parse(JSON.stringify(evidence)); invalid.witnesses[0].host = host;
    assert.throws(() => assertAgentExpiryEvidence(candidate(), invalid, now));
  }
});

test("absence alone, bad cluster, stale roots, pruned history and any observed transaction cannot release", async () => {
  const cases: Record<string, unknown> = {
    getGenesisHash: "devnet", getBlockHeight: 100, getBlockTime: Math.floor((now - 180_000) / 1000),
    isBlockhashValid: { context: { slot: 201 }, value: true },
    getSignatureStatuses: { context: { slot: 201 }, value: [{ confirmationStatus: "processed" }] },
    getSignaturesForAddress: [],
  };
  for (const [method, invalid] of Object.entries(cases)) {
    assert.equal(await fixture((m, _p, url, value) => url === urls[1] && m === method ? invalid : value).read(), null, method);
  }
  for (const confirmationStatus of ["processed", "confirmed", "finalized"]) {
    assert.equal(await fixture((m, _p, _u, v) => m === "getSignatureStatuses" ?
      { context: { slot: 201 }, value: [{ confirmationStatus, err: null }] } : v).read(), null);
  }
  assert.equal(await fixture((m, p, _u, v) => m === "getTransaction" && p[0] === signature ? { slot: 100 } : v).read(), null);
  assert.equal(await fixture((m, p, _u, v) => m === "getTransaction" && p[0] === prior ? null : v).read(), null);
  for (const signatures of [undefined, [], [signature]]) {
    assert.equal(await fixture((m, p, _u, v) => m === "getTransaction" && p[0] === prior ?
      { ...(v as object), transaction: { signatures, message: { accountKeys: [{ pubkey: wallet }] } } } : v).read(), null);
  }
  assert.equal(await fixture((m, _p, _u, v) => m === "getSignaturesForAddress" ? [{ signature, slot: 100, blockTime: now / 1000 }] : v).read(), null);
  assert.equal(await fixture((m, _p, _u, v) => m === "isBlockhashValid" ? { context: { slot: 199 }, value: false } : v).read(), null);
  assert.equal(await fixture((m, _p, _u, v) => m === "getSignatureStatuses" ? { context: { slot: 199 }, value: [null] } : v).read(), null);
});

test("malformed responses, transport failure and same-host endpoints fail closed", async () => {
  for (const method of ["getSlot", "getBlockHeight", "isBlockhashValid", "getSignatureStatuses", "getSignaturesForAddress"]) {
    assert.equal(await fixture((m, _p, _u, v) => m === method ? undefined : v).read(), null, method);
  }
  assert.equal(await fixture(() => { throw new Error("network"); }).read(), null);
  assert.equal(await fixture().read(candidate(), [urls[0], "https://rpc-a.test/different"]), null);
  assert.equal(await fixture().read(candidate(), [urls[0], "http://rpc-b.test"]), null);
});

test("wrong message binding, malformed wire, durable nonce, missing signature and old operations never expire automatically", async () => {
  const c = candidate();
  for (const input of [candidate(true), { ...c, messageFingerprint: "x".repeat(43) },
    { ...c, submittedAt: new Date(now - 89_999).toISOString() }, { ...c, submittedAt: null },
    { ...c, transactionSignature: null }, { ...c, status: "SIGNED" },
    { ...c, createdAt: new Date(now - 86_400_001).toISOString() },
    { ...c, preparedContext: { ...c.preparedContext!, transaction: "bad" } }]) {
    const f = fixture();
    assert.equal(await f.read(input), null);
    assert.equal(f.calls.length, 0);
  }
});
