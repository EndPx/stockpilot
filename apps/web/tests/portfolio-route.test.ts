import assert from "node:assert/strict";
import test from "node:test";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { PreStocksProviderError } from "@stockpilot/core/assets";
import { AUTH_SESSION_COOKIE } from "../lib/auth/config";
import { createAuthSession, encodeAuthSession } from "../lib/auth/session";
import { SolanaBalanceReadError } from "../lib/solana/read-adapter";
import { createPortfolioGet } from "../app/api/portfolio/route";

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
  const token = await encodeAuthSession(createAuthSession(walletAddress), process.env.SESSION_SECRET!);
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
