import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  address, compileTransaction, createTransactionMessage, getAddressDecoder,
  getTransactionEncoder, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, signatureBytes, type Blockhash,
} from "@solana/kit";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { createDemoPreparePost } from "../app/api/investments/demo/prepare/route";
import { createDemoExecutePost } from "../app/api/investments/demo/execute/route";
import { ManualBuyLedgerError } from "../lib/control-plane/manual-executions";
import { createInvestmentAuthorization, readInvestmentAuthorization, type InvestmentAuthorization } from "../lib/investments/authorization";
import { prepareDemoTrade, type DemoTradeRequest } from "../lib/investments/demo-trade";
import { executeManualTradeOnce } from "../lib/investments/manual-execution";
import { InvestmentApiError } from "../lib/investments/errors";

// Ephemeral offline signing fixture; no funded key or broadcast is used.
const keys = generateKeyPairSync("ed25519");
const wallet = getAddressDecoder().decode(keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const otherWallet = "So11111111111111111111111111111111111111112";
const mint = "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP";
const xMint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const requestId = `build:${"a".repeat(64)}`;
const signature = "1".repeat(88);
const secret = "investment-demo-route-test-secret-over-32-bytes";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = secret;
process.env.INVESTMENTS_ENABLED = "true";
process.env.AUTH_ENABLED = "true";
process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";
process.env.STOCKPILOT_DEMO_TRADER_WALLET = wallet;

const identity = async () => ({ kind: "session" as const, authProvider: "privy" as const,
  privyUserId: "did:privy:demo-owner", walletAddress: wallet, sessionId: "session",
  issuedAt: Date.now(), expiresAt: Date.now() + 60_000 });
const trade: DemoTradeRequest = { side: "BUY", provider: "prestocks", mintAddress: mint,
  amount: "0.10", eligibleNonUsAttestation: true };
const asset: InvestmentAsset = { id: `prestocks:${mint}`, provider: "prestocks", marketType: "PRE_IPO",
  symbol: "POLYMARKET", name: "Polymarket PreStocks", canonical: true, executionStatus: "UNKNOWN",
  mintAddress: mint, description: null, imageUrl: null, tokenPriceUsd: 150 };

function wire(signed = false, changed = false) {
  const message = pipe(createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(address(wallet), value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: (changed ? otherWallet : "11111111111111111111111111111111") as Blockhash,
      lastValidBlockHeight: 200n,
    }, value));
  const compiled = compileTransaction(message);
  return Buffer.from(getTransactionEncoder().encode({ ...compiled, signatures: {
    ...compiled.signatures,
    [wallet]: signed ? signatureBytes(sign(null, Uint8Array.from(compiled.messageBytes), keys.privateKey)) : null,
  } })).toString("base64");
}

function result(): Awaited<ReturnType<typeof prepareDemoTrade>> {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    asset, effects: { maximumInputRaw: "100000", requiredMinimumOutputRaw: "600000",
      maximumWalletNativeDebitLamportsRaw: "10006000" },
    prepared: { walletAddress: wallet, asset: { symbol: asset.symbol, name: asset.name, mintAddress: mint },
      fundingAsset: { symbol: "USDC", mintAddress: SOLANA_MAINNET_USDC_MINT },
      inputAmountRaw: "100000", inputAmountUsd: "0.1", outputAmountRaw: "650000", outputDecimals: 9,
      router: "Meteora DLMM", mode: "manual", feeBps: 0, feeMint: null, priceImpactPct: "0.1",
      transaction: wire(), requestId, lastValidBlockHeight: "200", expireAt: expiresAt,
      createdAt: new Date().toISOString() },
    review: { requestId, side: "BUY", provider: "prestocks", symbol: asset.symbol, name: asset.name,
      walletAddress: wallet, inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mint,
      inputAmountRaw: "100000", inputAmount: "0.1", estimatedOutputAmount: "0.00065",
      minimumOutputAmount: "0.0006", requiredMinimumOutputRaw: "600000",
      maximumWalletNativeDebitLamportsRaw: "10006000", priceImpactPct: "0.1", router: "Meteora DLMM", expiresAt },
  };
}

function authorization(overrides: Partial<InvestmentAuthorization> = {}): InvestmentAuthorization {
  return { kind: "investment", side: "BUY", provider: "prestocks", walletAddress: wallet,
    requestId, inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mint, inputAmountRaw: "100000",
    inputDecimals: 6, outputDecimals: 9, symbol: asset.symbol, requiredMinimumOutputRaw: "600000",
    maximumWalletNativeDebitLamportsRaw: "10006000", messageFingerprint: "a".repeat(43),
    lastValidBlockHeight: "200", orderExpireAt: null, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    ...overrides };
}

function request(body: unknown, origin: string | null = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/investments/demo/test", { method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
}
async function code(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}
const executeBody = { signedTransaction: "signed-wire", investmentToken: "bound-token" };

test("demo routes enforce kill switch before reading identities or orders", async () => {
  let called = false;
  const readIdentity = async () => { called = true; return identity(); };
  process.env.INVESTMENTS_ENABLED = "false";
  try {
    for (const post of [createDemoPreparePost({ readIdentity }), createDemoExecutePost({ readIdentity })]) {
      const response = await post(request(trade));
      assert.equal(response.status, 503);
      assert.equal(await code(response), "INVESTMENTS_DISABLED");
    }
    assert.equal(called, false);
  } finally { process.env.INVESTMENTS_ENABLED = "true"; }
});

test("demo routes reject absent sessions and missing or foreign origins", async () => {
  for (const post of [createDemoPreparePost(), createDemoExecutePost()]) {
    const noSession = await post(request(trade));
    assert.equal(noSession.status, 401);
    assert.equal(await code(noSession), "UNAUTHENTICATED");
    for (const origin of [null, "https://attacker.test"]) {
      const response = await post(request(trade, origin));
      assert.equal(response.status, 403);
      assert.equal(await code(response), "INVALID_REQUEST");
    }
  }
});

test("demo routes reject legacy sessions before any preparation or submission", async () => {
  const readIdentity = async () => ({ ...await identity(), authProvider: undefined, privyUserId: undefined });
  for (const post of [createDemoPreparePost({ readIdentity }), createDemoExecutePost({ readIdentity })]) {
    const response = await post(request(trade));
    assert.equal(response.status, 401);
    assert.equal(await code(response), "UNAUTHENTICATED");
  }
});

test("demo owner allowlist rejects other wallets before external asset or quote reads", async () => {
  const readIdentity = async () => ({ ...await identity(), walletAddress: otherWallet });
  const prepare = createDemoPreparePost({ readIdentity, checkUnresolved: async () => {} });
  const execute = createDemoExecutePost({ readIdentity });
  const response = await prepare(request(trade));
  assert.equal(response.status, 403);
  assert.equal(await code(response), "ASSET_NOT_ALLOWED");
  assert.equal((await execute(request(executeBody))).status, 401);
});

test("demo prepare forbids client wallet fields and requires the attestation", async () => {
  let called = false;
  const post = createDemoPreparePost({ readIdentity: identity,
    checkUnresolved: async () => { called = true; } });
  for (const body of [{ ...trade, walletAddress: otherWallet }, { ...trade, eligibleNonUsAttestation: false },
    { ...trade, transaction: "client-transaction" }, { ...trade, amount: 0.1 }]) {
    const response = await post(request(body));
    assert.equal(response.status, 400);
    assert.equal(await code(response), "INVALID_REQUEST");
  }
  assert.equal(called, false);
});

test("demo prepare blocks a new quote while a previous trade is unresolved", async () => {
  let prepared = false;
  const post = createDemoPreparePost({ readIdentity: identity,
    checkUnresolved: async () => { throw new ManualBuyLedgerError("UNRESOLVED_TRADE", "unresolved"); },
    prepare: async () => { prepared = true; return result(); } });
  const response = await post(request(trade));
  assert.equal(response.status, 409);
  assert.equal(await code(response), "UNRESOLVED_TRADE");
  assert.equal(prepared, false);
});

test("demo prepare binds review fields and verified owner into the real signed authorization", async () => {
  const seen: unknown[] = [];
  const post = createDemoPreparePost({ readIdentity: identity,
    checkUnresolved: async (input) => { seen.push(input); },
    prepare: async (...input) => { seen.push(input); return result(); } });
  const response = await post(request(trade));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(seen[0], { accountId: "did:privy:demo-owner", walletAddress: wallet });
  assert.deepEqual(seen[1], [wallet, "did:privy:demo-owner", trade]);
  const body = await response.json() as { investmentToken: string; transaction: string };
  const token = await readInvestmentAuthorization(body.investmentToken, secret);
  assert.equal(token.requestId, requestId);
  assert.equal(token.walletAddress, wallet);
  assert.equal(token.side, "BUY");
  assert.equal(token.provider, "prestocks");
  assert.equal(token.inputMint, SOLANA_MAINNET_USDC_MINT);
  assert.equal(token.outputMint, mint);
  assert.equal(token.inputAmountRaw, "100000");
  assert.equal(token.requiredMinimumOutputRaw, "600000");
  assert.equal(token.maximumWalletNativeDebitLamportsRaw, "10006000");
  assert.equal(token.outputDecimals, 9);
  assert.equal(body.transaction, wire());
});

test("demo execute rejects tampered authorization and client execution fields", async () => {
  let submitted = false;
  const post = createDemoExecutePost({ readIdentity: identity,
    executeManual: async () => { submitted = true; return { status: "PENDING", requestId, signature }; } });
  const invalidToken = await post(request(executeBody));
  assert.equal(invalidToken.status, 401);
  assert.equal(await code(invalidToken), "INVESTMENT_TOKEN_INVALID");
  for (const field of ["walletAddress", "inputMint", "requestId", "side", "amount"]) {
    const response = await post(request({ ...executeBody, [field]: "attacker-controlled" }));
    assert.equal(response.status, 400);
    assert.equal(await code(response), "INVALID_REQUEST");
  }
  assert.equal(submitted, false);
});

test("demo execute reports not submitted only for failures before entering its durable executor", async () => {
  const preSubmit = createDemoExecutePost({ readIdentity: identity });
  const response = await preSubmit(request(executeBody));
  const body = await response.json() as { error: { code: string; submissionStatus?: string } };
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "INVESTMENT_TOKEN_INVALID");
  assert.equal(body.error.submissionStatus, "NOT_SUBMITTED");

  const started = createDemoExecutePost({ readIdentity: identity,
    readAuthorization: async () => authorization(), resolveAsset: async () => asset,
    executeManual: async () => { throw new InvestmentApiError("PROVIDER_UNAVAILABLE", 503); } });
  const ambiguous = await started(request(executeBody));
  const ambiguousBody = await ambiguous.json() as { error: { code: string; submissionStatus?: string } };
  assert.equal(ambiguous.status, 503);
  assert.equal(ambiguousBody.error.code, "PROVIDER_UNAVAILABLE");
  assert.equal(ambiguousBody.error.submissionStatus, undefined);
});

test("demo execute marks proven pre-claim failures but not a lost claim response", async () => {
  for (const failure of ["expired", "height", "signature", "claim"] as const) {
    let claimed = false;
    let submitted = false;
    const post = createDemoExecutePost({ readIdentity: identity,
      readAuthorization: async () => authorization(failure === "expired" ? { expiresAt: Date.now() - 1 } : {}),
      resolveAsset: async () => asset,
      executeManual: async (value) => executeManualTradeOnce(value, {
        blockHeight: async () => { if (failure === "height") throw new Error("RPC unavailable"); return 1n; },
        assertSigned: async () => { if (failure === "signature") throw new Error("invalid signature"); },
        signature: () => signature,
        claim: async () => { claimed = true; throw new Error("database response lost"); },
        execute: async () => { submitted = true; throw new Error("must not submit"); },
      }) });
    const response = await post(request(executeBody));
    const body = await response.json() as { error: { submissionStatus?: string } };
    assert.equal(body.error.submissionStatus, failure === "claim" ? undefined : "NOT_SUBMITTED", failure);
    assert.equal(claimed, failure === "claim", failure);
    assert.equal(submitted, false, failure);
  }
});

test("demo execute binds wallet, build identifier, provider and current asset symbol before claiming", async () => {
  let submitted = false;
  for (const value of [authorization({ walletAddress: otherWallet }), authorization({ requestId: "ultra-order" }),
    authorization({ provider: undefined }), authorization({ symbol: "FAKE" })]) {
    const post = createDemoExecutePost({ readIdentity: identity, readAuthorization: async () => value,
      resolveAsset: async () => asset,
      executeManual: async () => { submitted = true; return { status: "PENDING", requestId, signature }; } });
    const response = await post(request(executeBody));
    assert.ok([401, 403, 409].includes(response.status));
  }
  assert.equal(submitted, false);
});

test("demo execute accepts only the two selected assets even with a valid server authorization", async () => {
  const post = createDemoExecutePost({ readIdentity: identity,
    readAuthorization: async () => authorization({ outputMint: otherWallet }) });
  const response = await post(request(executeBody));
  assert.equal(response.status, 403);
  assert.equal(await code(response), "ASSET_NOT_ALLOWED");
});

test("demo execute selects the sold token for fresh asset verification and exposes only finalized amounts", async () => {
  const auth = authorization({ side: "SELL", provider: "xstocks", inputMint: xMint,
    outputMint: SOLANA_MAINNET_USDC_MINT, inputDecimals: 8, outputDecimals: 6, symbol: "AAPLx" });
  const seen: unknown[] = [];
  const post = createDemoExecutePost({ readIdentity: identity, readAuthorization: async () => auth,
    resolveAsset: async (...input) => { seen.push(input); return { ...asset, symbol: "AAPLx" }; },
    executeManual: async (input) => { seen.push(input); return { status: "PENDING", requestId, signature }; } });
  const response = await post(request(executeBody));
  assert.equal(response.status, 202);
  assert.deepEqual(seen[0], ["xstocks", xMint]);
  assert.deepEqual(seen[1], { accountId: "did:privy:demo-owner", walletAddress: wallet,
    authorization: auth, signedTransaction: executeBody.signedTransaction });
  const body = await response.json() as { execution: { side: string; actualInputAmountRaw: unknown; actualOutputAmountRaw: unknown } };
  assert.equal(body.execution.side, "SELL");
  assert.equal(body.execution.actualInputAmountRaw, null);
  assert.equal(body.execution.actualOutputAmountRaw, null);
});

test("a valid wallet signature over a changed transaction cannot cross the durable claim boundary", async () => {
  const auth = authorization();
  const { kind: _kind, createdAt: _created, expiresAt: _expires, messageFingerprint: _fingerprint, ...input } = auth;
  const token = await createInvestmentAuthorization({ ...input, transaction: wire() }, secret);
  let claimed = false;
  const post = createDemoExecutePost({ readIdentity: identity, resolveAsset: async () => asset,
    executeManual: async (value) => executeManualTradeOnce(value, {
      blockHeight: async () => 1n,
      claim: async () => { claimed = true; throw new Error("must not claim"); },
    }) });
  const response = await post(request({ investmentToken: token, signedTransaction: wire(true, true) }));
  assert.equal(response.status, 409);
  assert.equal(await code(response), "TRANSACTION_MISMATCH");
  assert.equal(claimed, false);
});
