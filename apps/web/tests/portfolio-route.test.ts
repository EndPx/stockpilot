import assert from "node:assert/strict";
import test from "node:test";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { PreStocksProviderError } from "@stockpilot/core/assets";
import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "../lib/auth/config";
import { AuthError } from "../lib/auth/errors";
import { createAuthSession, encodeAuthSession, registerAuthSession } from "../lib/auth/session";
import { SolanaBalanceReadError } from "../lib/solana/read-adapter";
import { createPortfolioGet } from "../app/api/portfolio/route";
import { MemoryAuthSecurityStore } from "../lib/auth/store";
import { readInvestmentSessionWallet } from "../lib/investments/session";

process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "portfolio-route-test-secret-at-least-32-bytes";

const walletAddress = "11111111111111111111111111111111";
const attackerAddress = "So11111111111111111111111111111111111111112";

function portfolio(wallet = walletAddress): Portfolio {
  return {
    walletAddress: wallet,
    funding: {
      usdc: {
        mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "200",
        amountUsd: 200,
      },
      sol: { amount: "0.42" },
    },
    portfolioValueUsd: 0,
    positions: [],
    asOf: new Date(0).toISOString(),
  };
}

async function authenticatedRequest(path = "/api/portfolio", headers: HeadersInit = {}) {
  const session = createAuthSession(walletAddress);
  await registerAuthSession(session);
  const token = await encodeAuthSession(session, process.env.SESSION_SECRET!);
  return new Request(`http://localhost:3000${path}`, {
    headers: { ...headers, cookie: `${AUTH_SESSION_COOKIE}=${token}` },
  });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

test("authenticated portfolio request reads the verified session wallet", async () => {
  const seen: string[] = [];
  const get = createPortfolioGet(async (wallet) => {
    seen.push(wallet);
    return portfolio(wallet);
  });
  const response = await get(await authenticatedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [walletAddress]);
  assert.equal(((await response.json()) as { portfolio: Portfolio }).portfolio.walletAddress, walletAddress);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unauthenticated and invalid sessions return the stable 401 contract", async () => {
  const get = createPortfolioGet(async () => portfolio());
  const missing = await get(new Request("http://localhost:3000/api/portfolio"));
  assert.equal(missing.status, 401);
  assert.equal(await errorCode(missing), "UNAUTHENTICATED");

  const invalid = await get(new Request("http://localhost:3000/api/portfolio", {
    headers: { cookie: `${AUTH_SESSION_COOKIE}=v1.tampered.invalid` },
  }));
  assert.equal(invalid.status, 401);
  assert.equal(await errorCode(invalid), "UNAUTHENTICATED");
});

test("query and header wallets cannot override the authenticated session", async () => {
  const seen: string[] = [];
  const get = createPortfolioGet(async (wallet) => {
    seen.push(wallet);
    return portfolio(wallet);
  });
  const request = await authenticatedRequest(
    `/api/portfolio?wallet=${attackerAddress}`,
    { "x-wallet-address": attackerAddress },
  );
  assert.equal((await get(request)).status, 200);
  assert.deepEqual(seen, [walletAddress]);
});

test("Solana and PreStocks failures remain distinct unavailable responses", async () => {
  const rpc = createPortfolioGet(async () => {
    throw new SolanaBalanceReadError();
  });
  const provider = createPortfolioGet(async () => {
    throw new PreStocksProviderError();
  });
  const [rpcResponse, providerResponse] = await Promise.all([
    rpc(await authenticatedRequest()),
    provider(await authenticatedRequest()),
  ]);
  assert.equal(rpcResponse.status, 503);
  assert.equal(await errorCode(rpcResponse), "SOLANA_RPC_UNAVAILABLE");
  assert.equal(providerResponse.status, 503);
  assert.equal(await errorCode(providerResponse), "PRESTOCKS_UNAVAILABLE");
});

test("unexpected portfolio failures do not become an empty success", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const get = createPortfolioGet(async () => { throw new Error("malformed aggregate"); });
    const response = await get(await authenticatedRequest());
    assert.equal(response.status, 503);
    assert.equal(await errorCode(response), "PORTFOLIO_UNAVAILABLE");
  } finally {
    console.error = originalError;
  }
});

test("revoked copied cookies cannot read portfolio or authenticate investments", async () => {
  const config = getAuthRuntimeConfig();
  const store = new MemoryAuthSecurityStore();
  const session = createAuthSession(walletAddress);
  await registerAuthSession(session, config, store);
  const token = await encodeAuthSession(session, config.sessionSecret);
  const request = new Request("http://localhost:3000/api/portfolio", { headers: { cookie: `${AUTH_SESSION_COOKIE}=${token}` } });
  let reads = 0;
  const get = createPortfolioGet(async () => { reads++; return portfolio(); }, store);
  assert.equal((await get(request)).status, 200);
  assert.equal(await readInvestmentSessionWallet(request, config, store), walletAddress);
  await store.revokeSession(session.sessionId);
  const denied = await get(request);
  assert.equal(denied.status, 401);
  assert.equal(await errorCode(denied), "UNAUTHENTICATED");
  await assert.rejects(readInvestmentSessionWallet(request, config, store), /Sign in with your wallet/);
  assert.equal(reads, 1);
});

test("portfolio wallet limits survive creation of a new session and prevent RPC work", async () => {
  const config = getAuthRuntimeConfig();
  const store = new MemoryAuthSecurityStore();
  let reads = 0;
  const get = createPortfolioGet(async () => { reads++; return portfolio(); }, store);
  async function signedRequest() {
    const session = createAuthSession(walletAddress);
    await registerAuthSession(session, config, store);
    const token = await encodeAuthSession(session, config.sessionSecret);
    return new Request("http://localhost:3000/api/portfolio", { headers: { cookie: `${AUTH_SESSION_COOKIE}=${token}` } });
  }
  const first = await signedRequest();
  for (let index = 0; index < 60; index++) assert.equal((await get(first)).status, 200);
  const response = await get(await signedRequest());
  assert.equal(response.status, 429);
  assert.equal(await errorCode(response), "AUTH_RATE_LIMITED");
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(reads, 60);
});

test("security-store failure preserves unavailable status and never invokes RPC", async () => {
  const config = getAuthRuntimeConfig();
  const store = new MemoryAuthSecurityStore();
  const session = createAuthSession(walletAddress);
  await registerAuthSession(session, config, store);
  const token = await encodeAuthSession(session, config.sessionSecret);
  const request = new Request("http://localhost:3000/api/portfolio", { headers: { cookie: `${AUTH_SESSION_COOKIE}=${token}` } });
  store.readSession = async () => { throw new AuthError("AUTH_UNAVAILABLE", 503); };
  const get = createPortfolioGet(async () => { assert.fail("RPC must not run without the security store"); }, store);
  const response = await get(request);
  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "AUTH_UNAVAILABLE");
  await assert.rejects(readInvestmentSessionWallet(request, config, store), (error) => error instanceof AuthError && error.status === 503);
});
