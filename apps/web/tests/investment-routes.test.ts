import assert from "node:assert/strict";
import test from "node:test";
import { InvestmentError, type PreparedInvestment } from "@stockpilot/core/investments";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { JupiterOrderNotExecutableError, type JupiterExecutionResult } from "@stockpilot/integrations/jupiter-v2";
import { createInvestmentExecutePost } from "../app/api/investments/execute/route";
import { createInvestmentPreparePost } from "../app/api/investments/prepare/route";
import { AUTH_SESSION_COOKIE } from "../lib/auth/config";
import { createAuthSession, encodeAuthSession, registerAuthSession } from "../lib/auth/session";
import { InvestmentSecurityError, type InvestmentAuthorization } from "../lib/investments/authorization";

process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "investment-route-test-secret-at-least-32-bytes";
process.env.INVESTMENTS_ENABLED = "true";
process.env.AUTH_ENABLED = "true";

const wallet = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const otherWallet = "So11111111111111111111111111111111111111112";
const mint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const signature = "1".repeat(64);

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

function execution(overrides: Partial<JupiterExecutionResult> = {}): JupiterExecutionResult {
  return {
    status: "Success",
    signature,
    code: null,
    error: null,
    totalInputAmount: "49999999",
    totalOutputAmount: "124000000",
    ...overrides,
  };
}

async function request(path: string, body: unknown, options: { wallet?: string; origin?: string; authenticated?: boolean } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: options.origin ?? "http://localhost:3000",
  };
  if (options.authenticated !== false) {
    const session = createAuthSession(options.wallet ?? wallet);
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
  const post = createInvestmentPreparePost({
    now: () => 1_700_000_000_000,
    async prepare(input) { seen.push(input); return prepared(); },
    async authorize(value, secret, now) {
      seen.push({ requestId: value.requestId, secret, now });
      return "bound-investment-token";
    },
  });
  const response = await post(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" }));
  assert.equal(response.status, 200);
  assert.deepEqual(seen[0], { symbol: "SPACEX", amountUsd: "50", walletAddress: wallet });
  const body = await response.json() as { investment: { estimatedOutputAmount: string; expiresAt: string }; investmentToken: string };
  assert.equal(body.investment.estimatedOutputAmount, "0.125");
  assert.equal(body.investment.expiresAt, "2023-11-14T22:15:20.000Z");
  assert.equal(body.investmentToken, "bound-investment-token");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("prepare rejects unauthenticated, cross-origin, and client-selected execution fields", async () => {
  let calls = 0;
  const post = createInvestmentPreparePost({ async prepare() { calls += 1; return prepared(); } });
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
  const insufficient = createInvestmentPreparePost({
    async prepare() { throw new InvestmentError("INSUFFICIENT_USDC", "Your wallet does not have enough USDC for this investment."); },
  });
  const noTransaction = createInvestmentPreparePost({
    async prepare() { throw new JupiterOrderNotExecutableError(-2); },
  });
  const [balanceResponse, orderResponse] = await Promise.all([
    insufficient(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" })),
    noTransaction(await request("/api/investments/prepare", { symbol: "SPACEX", amountUsd: "50" })),
  ]);
  assert.equal(await errorCode(balanceResponse), "INSUFFICIENT_USDC");
  assert.equal(await errorCode(orderResponse), "JUPITER_ORDER_NOT_EXECUTABLE");
});

test("execute recovers request identity only from the bound token and returns actual Jupiter amounts", async () => {
  const seen: unknown[] = [];
  const post = createInvestmentExecutePost({
    async readAuthorization(token) { seen.push({ token }); return authorization(); },
    assertWallet(value, sessionWallet) { seen.push({ tokenWallet: value.walletAddress, sessionWallet }); },
    assertValid(_value, blockHeight) { seen.push({ blockHeight }); },
    async assertSigned(signed, sessionWallet, fingerprint) { seen.push({ signed, sessionWallet, fingerprint }); },
    async blockHeight() { return 199n; },
    async execute(input) { seen.push(input); return execution(); },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed-wire-transaction",
    investmentToken: "bound-token",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(seen.at(-1), {
    signedTransaction: "signed-wire-transaction",
    requestId: "bound-request-id",
    lastValidBlockHeight: "200",
  });
  const body = await response.json() as { execution: { inputAmountUsd: string; outputAmount: string; solscanUrl: string } };
  assert.equal(body.execution.inputAmountUsd, "49.999999");
  assert.equal(body.execution.outputAmount, "0.124");
  assert.equal(body.execution.solscanUrl, `https://solscan.io/tx/${signature}`);
});

test("execute accepts only signedTransaction and investmentToken", async () => {
  let reads = 0;
  const post = createInvestmentExecutePost({
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

test("execute rejects a token owned by a different session wallet before Jupiter", async () => {
  let executed = false;
  const post = createInvestmentExecutePost({
    async readAuthorization() { return authorization(); },
    assertWallet(value, sessionWallet) {
      if (value.walletAddress !== sessionWallet) {
        throw new InvestmentSecurityError("WALLET_MISMATCH", "wallet mismatch");
      }
    },
    async execute() { executed = true; return execution(); },
  });
  const response = await post(await request("/api/investments/execute", {
    signedTransaction: "signed",
    investmentToken: "token",
  }, { wallet: otherWallet }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "WALLET_MISMATCH");
  assert.equal(executed, false);
});

test("execute distinguishes expired orders from other transaction failures", async () => {
  const expired = createInvestmentExecutePost({
    async readAuthorization() { return authorization({ lastValidBlockHeight: null }); },
    async assertSigned() {},
    async execute() { return execution({ status: "Failed", signature: null, code: -2003, error: "expired", totalInputAmount: null, totalOutputAmount: null }); },
  });
  const failed = createInvestmentExecutePost({
    async readAuthorization() { return authorization({ lastValidBlockHeight: null }); },
    async assertSigned() {},
    async execute() { return execution({ status: "Failed", signature: null, code: -2002, error: "invalid", totalInputAmount: null, totalOutputAmount: null }); },
  });
  const [expiredResponse, failedResponse] = await Promise.all([
    expired(await request("/api/investments/execute", { signedTransaction: "signed", investmentToken: "token" })),
    failed(await request("/api/investments/execute", { signedTransaction: "signed", investmentToken: "token" })),
  ]);
  assert.equal(await errorCode(expiredResponse), "JUPITER_ORDER_EXPIRED");
  assert.equal(await errorCode(failedResponse), "TRANSACTION_FAILED");
});
