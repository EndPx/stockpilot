import assert from "node:assert/strict";
import test from "node:test";
import { InvestmentError, type PreparedInvestment } from "@stockpilot/core/investments";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { JupiterOrderNotExecutableError } from "@stockpilot/integrations/jupiter-v2";
import { createInvestmentExecutePost } from "../app/api/investments/execute/route";
import { createInvestmentPreparePost } from "../app/api/investments/prepare/route";
import { AUTH_SESSION_COOKIE } from "../lib/auth/config";
import { createAuthSession, encodeAuthSession, registerAuthSession } from "../lib/auth/session";
import { ManualBuyLedgerError } from "../lib/control-plane/manual-executions";
import { type InvestmentAuthorization } from "../lib/investments/authorization";
import { InvestmentApiError } from "../lib/investments/errors";

const createPrepare = (dependencies: Parameters<typeof createInvestmentPreparePost>[0] = {}) =>
  createInvestmentPreparePost({ checkUnresolved: async () => {}, ...dependencies });

process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "investment-route-test-secret-at-least-32-bytes";
process.env.INVESTMENTS_ENABLED = "true";
process.env.AUTH_ENABLED = "true";
process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";

const wallet = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const otherWallet = "So11111111111111111111111111111111111111112";
const mint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const signature = "1".repeat(88);

function prepared(): PreparedInvestment {
  return {
    walletAddress: wallet,
    asset: { symbol: "SPACEX", name: "SpaceX PreStocks", mintAddress: mint },
    fundingAsset: { symbol: "USDC", mintAddress: SOLANA_MAINNET_USDC_MINT },
    inputAmountRaw: "50000000",
    inputAmountUsd: "50",
    outputAmountRaw: "125000000",
    outputDecimals: 9,
    router: "metis",
    mode: "ultra",
    feeBps: 10,
    feeMint: SOLANA_MAINNET_USDC_MINT,
    priceImpactPct: "0.01",
    transaction: "AQID",
    requestId: "bound-request-id",
    lastValidBlockHeight: "200",
    expireAt: null,
    createdAt: new Date(0).toISOString(),
  };
}

function authorization(overrides: Partial<InvestmentAuthorization> = {}): InvestmentAuthorization {
  return {
    kind: "investment",
    walletAddress: wallet,
    requestId: "bound-request-id",
    inputMint: SOLANA_MAINNET_USDC_MINT,
    outputMint: mint,
    inputAmountRaw: "50000000",
    requiredMinimumOutputRaw: null,
    maximumWalletNativeDebitLamportsRaw: null,
    outputDecimals: 9,
    symbol: "SPACEX",
    messageFingerprint: "a".repeat(43),
    lastValidBlockHeight: "200",
    orderExpireAt: null,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_120_000,
    ...overrides,
  };
}

const privyIdentity = async () => ({ kind: "session" as const, authProvider: "privy" as const,
  privyUserId: "did:privy:owner", walletAddress: wallet, sessionId: "session", issuedAt: 1, expiresAt: 2_000_000_000_000 });

async function request(path: string, body: unknown, options: { wallet?: string; origin?: string; authenticated?: boolean } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: options.origin ?? "http://localhost:3000",
  };
  if (options.authenticated !== false) {
    const session = createAuthSession(options.wallet ?? wallet, Date.now(), "did:privy:owner", Date.now() + 60 * 60_000);
    await registerAuthSession(session);
    const token = await encodeAuthSession(session, process.env.SESSION_SECRET!);
    headers.cookie = `${AUTH_SESSION_COOKIE}=${token}`;
  }
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

test("prepare derives the taker from session and returns normalized review data", async () => {
  const seen: unknown[] = [];
  const post = createPrepare({
    now: () => 1_700_000_000_000,
    checkAsset: async () => mint,
    checkInvestor: async () => {},
    async prepare(input) { seen.push(input); return prepared(); },
    async validatePrepared(value) {
      seen.push({ validatedRequestId: value.requestId });
      return { maximumInputRaw: "50000000", requiredMinimumOutputRaw: "100000000",
        maximumWalletNativeDebitLamportsRaw: "300000" };
    },
    async authorize(value, effects, secret, now) {
      seen.push({ requestId: value.requestId, effects, secret, now });
      return "bound-investment-token";
    },
  });
  const response = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" }));
  assert.equal(response.status, 200);
  assert.deepEqual(seen[0], { symbol: "SPACEX", amountUsd: "50", walletAddress: wallet });
  assert.deepEqual(seen[1], { validatedRequestId: "bound-request-id" });
  const body = await response.json() as { investment: { estimatedOutputAmount: string; expiresAt: string }; investmentToken: string };
  assert.equal(body.investment.estimatedOutputAmount, "0.125");
  assert.equal(body.investment.expiresAt, "2023-11-14T22:15:20.000Z");
  assert.equal(body.investmentToken, "bound-investment-token");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("prepare does not mint a review token when transaction semantics have not been verified", async () => {
  let authorized = false;
  const post = createPrepare({
    checkAsset: async () => mint,
    checkInvestor: async () => {},
    async prepare() { return prepared(); },
    async authorize() { authorized = true; return "unsafe-token"; },
  });
  const response = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" }));
  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "INVESTMENT_ORDER_UNVERIFIED");
  assert.equal(authorized, false);
});

test("prepare rejects unauthenticated, cross-origin, and client-selected execution fields", async () => {
  let calls = 0;
  const post = createPrepare({ checkAsset: async () => mint, checkInvestor: async () => {},
    async prepare() { calls += 1; return prepared(); } });
  const unauthenticated = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "1" }, { authenticated: false }));
  assert.equal(unauthenticated.status, 401);
  assert.equal(await errorCode(unauthenticated), "UNAUTHENTICATED");

  const crossOrigin = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "1" }, { origin: "https://attacker.test" }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(await errorCode(crossOrigin), "INVALID_REQUEST");

  for (const extra of ["walletAddress", "outputMint", "inputMint", "taker", "router", "transaction"]) {
    const response = await post(await request("/api/investments/prepare", {
      symbol: "SPACEX",
      amountUsd: "1",
      [extra]: "attacker-controlled",
    }));
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), "INVALID_REQUEST");
  }
  assert.equal(calls, 0);
});

test("prepare preserves insufficient-balance and non-executable-order error semantics", async () => {
  const insufficient = createPrepare({
    checkAsset: async () => mint,
    checkInvestor: async () => {},
    async prepare() { throw new InvestmentError("INSUFFICIENT_USDC", "Your wallet does not have enough USDC for this investment."); },
  });
  const noTransaction = createPrepare({
    checkAsset: async () => mint,
    checkInvestor: async () => {},
    async prepare() { throw new JupiterOrderNotExecutableError(-2); },
  });
  const [balanceResponse, orderResponse] = await Promise.all([
    insufficient(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" })),
    noTransaction(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" })),
  ]);
  assert.equal(await errorCode(balanceResponse), "INSUFFICIENT_USDC");
  assert.equal(await errorCode(orderResponse), "JUPITER_ORDER_NOT_EXECUTABLE");
});

test("prepare rejects missing product review before requesting a Jupiter quote", async () => {
  let quoted = false;
  const post = createPrepare({
    async checkAsset() { throw new InvestmentApiError("ASSET_NOT_ALLOWED", 409); },
    async prepare() { quoted = true; return prepared(); },
  });
  const response = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" }));
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "ASSET_NOT_ALLOWED");
  assert.equal(quoted, false);
});

test("prepare rejects missing investor review before requesting a Jupiter quote", async () => {
  let quoted = false;
  const post = createPrepare({
    checkAsset: async () => mint,
    async checkInvestor() { throw new InvestmentApiError("ASSET_NOT_ALLOWED", 403); },
    async prepare() { quoted = true; return prepared(); },
  });
  const response = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "ASSET_NOT_ALLOWED");
  assert.equal(quoted, false);
});

test("prepare blocks a second trade while the verified owner has an unresolved claim", async () => {
  let inspected = false;
  const post = createPrepare({
    async checkUnresolved() {
      throw new ManualBuyLedgerError("UNRESOLVED_TRADE", "An earlier trade is unresolved.");
    },
    async checkAsset() { inspected = true; return mint; },
    async prepare() { inspected = true; return prepared(); },
  });
  const response = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" }));
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "UNRESOLVED_TRADE");
  assert.equal(inspected, false);
});

test("prepare cannot authorize a different mint after pre-quote product review", async () => {
  let verified = false;
  const post = createPrepare({
    checkAsset: async () => otherWallet,
    checkInvestor: async () => {},
    async prepare() { return prepared(); },
    async validatePrepared() { verified = true; throw new Error("should not verify"); },
  });
  const response = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" }));
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "ASSET_NOT_ALLOWED");
  assert.equal(verified, false);
});

test("execute submits only through the durable manual service and reports pending until chain finality", async () => {
  const seen: unknown[] = [];
  const post = createInvestmentExecutePost({
    readIdentity: privyIdentity,
    assertFreshAsset: async () => {},
    checkInvestor: async () => {},
    async readAuthorization(token) { seen.push({ token }); return authorization(); },
    async executeManual(input) { seen.push(input); return { status: "PENDING", requestId: "bound-request-id", signature }; },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed-wire-transaction",
    investmentToken: "bound-token",
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(seen.at(-1), {
    accountId: "did:privy:owner",
    walletAddress: wallet,
    authorization: authorization(),
    signedTransaction: "signed-wire-transaction",
  });
  const body = await response.json() as { execution: { status: string; actualInputAmountRaw: string | null; solscanUrl: string } };
  assert.equal(body.execution.status, "PENDING");
  assert.equal(body.execution.actualInputAmountRaw, null);
  assert.equal(body.execution.solscanUrl, `https://solscan.io/tx/${signature}`);
});

test("execute accepts only signedTransaction and investmentToken", async () => {
  let reads = 0;
  const post = createInvestmentExecutePost({
    readIdentity: privyIdentity,
    assertFreshAsset: async () => {},
    checkInvestor: async () => {},
    async readAuthorization() { reads += 1; return authorization(); },
  });
  for (const extra of ["walletAddress", "requestId", "outputMint", "symbol", "amountUsd"]) {
    const response = await post(await request("/api/investments/execute", {
      signedTransaction: "signed",
      investmentToken: "token",
      [extra]: "attacker-controlled",
    }));
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), "INVALID_REQUEST");
  }
  assert.equal(reads, 0);
});

test("execute rejects a token owned by a different session wallet before a ledger claim", async () => {
  let executed = false;
  const post = createInvestmentExecutePost({
    readIdentity: async () => ({ ...await privyIdentity(), walletAddress: otherWallet }),
    assertFreshAsset: async () => {},
    checkInvestor: async () => {},
    async readAuthorization() { return authorization(); },
    async executeManual(input) {
      executed = true;
      return { status: "PENDING", requestId: "bound-request-id", signature };
    },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed",
    investmentToken: "token",
  }, { wallet: otherWallet }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "WALLET_MISMATCH");
  assert.equal(executed, false);
});

test("execute exposes terminal amounts only after finalized reconciliation", async () => {
  const post = createInvestmentExecutePost({
    readIdentity: privyIdentity,
    assertFreshAsset: async () => {},
    checkInvestor: async () => {},
    async readAuthorization() { return authorization(); },
    async executeManual() { return { status: "CONFIRMED", requestId: "bound-request-id", signature,
      actualInputAmountRaw: "49999999", actualOutputAmountRaw: "124000000" }; },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed", investmentToken: "token",
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { execution: { status: string; actualInputAmountRaw: string } };
  assert.equal(body.execution.status, "CONFIRMED");
  assert.equal(body.execution.actualInputAmountRaw, "49999999");
});

test("a conflicting durable claim is reported as a conflict, never resubmitted", async () => {
  let calls = 0;
  const post = createInvestmentExecutePost({
    readIdentity: privyIdentity,
    assertFreshAsset: async () => {},
    checkInvestor: async () => {},
    async readAuthorization() { return authorization(); },
    async executeManual() { calls++; throw new ManualBuyLedgerError("IDEMPOTENCY_CONFLICT", "different wire bytes"); },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed", investmentToken: "token",
  }));
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "TRANSACTION_MISMATCH");
  assert.equal(calls, 1);
});

test("execute rechecks issuer identity and availability before any durable claim", async () => {
  let executed = false;
  const post = createInvestmentExecutePost({
    readIdentity: privyIdentity,
    async readAuthorization() { return authorization(); },
    async assertFreshAsset() { throw new InvestmentApiError("ASSET_NOT_ALLOWED", 409); },
    async executeManual() {
      executed = true;
      return { status: "PENDING", requestId: "bound-request-id", signature };
    },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed", investmentToken: "token",
  }));
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "ASSET_NOT_ALLOWED");
  assert.equal(executed, false);
});

test("execute rechecks investor eligibility before any durable claim", async () => {
  let executed = false;
  const post = createInvestmentExecutePost({
    readIdentity: privyIdentity,
    async readAuthorization() { return authorization(); },
    assertFreshAsset: async () => {},
    async checkInvestor() { throw new InvestmentApiError("ASSET_NOT_ALLOWED", 403); },
    async executeManual() {
      executed = true;
      return { status: "PENDING", requestId: "bound-request-id", signature };
    },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed", investmentToken: "token",
  }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "ASSET_NOT_ALLOWED");
  assert.equal(executed, false);
});
