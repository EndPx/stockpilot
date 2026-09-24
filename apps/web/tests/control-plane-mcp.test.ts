import assert from "node:assert/strict";
import test from "node:test";
import type { InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import type { AgentPrincipal } from "../lib/control-plane/credentials";
import { createStockPilotMcp, resolveMcpAsset } from "../lib/control-plane/mcp";
import type { InvestmentRequestRecord } from "../lib/control-plane/requests";

const mint = "So11111111111111111111111111111111111111112";
const asset: InvestmentAsset = {
  id: `prestocks:${mint}`, name: "Example", symbol: "EX", mintAddress: mint, canonical: true,
  executionStatus: "UNKNOWN", provider: "prestocks", marketType: "PRE_IPO",
  description: null, imageUrl: null, tokenPriceUsd: 100,
};
const requestId = "c9780dca-f3a3-4212-9232-3c32fab8e33c";
const clientRequestId = "stockpilot_mcp_request_0001";
const saved: InvestmentRequestRecord = {
  id: requestId, clientId: "183fc984-91ea-4c08-9870-d62f3da31614", assetId: asset.id,
  assetName: asset.name, assetSymbol: asset.symbol, provider: "prestocks", marketType: "PRE_IPO",
  canonicalMint: mint, fundingMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amountUsd: "5.000000", clientRequestId, policyVersion: 1, policyMaxInvestmentUsd: "10.000000",
  status: "PENDING_APPROVAL", createdAt: "2026-09-23T00:00:00.000Z",
  expiresAt: "2026-09-23T00:15:00.000Z", decidedAt: null,
};
const principal: AgentPrincipal = {
  authMethod: "api_key",
  accountId: "did:privy:alice", walletAddress: "11111111111111111111111111111111",
  clientId: saved.clientId, credentialId: "c9780dca-f3a3-4212-9232-3c32fab8e33d",
  scopes: ["markets:read", "portfolio:read", "investments:request", "requests:read-own"],
};

function fixture(scopes = principal.scopes) {
  const calls: string[] = [];
  const handler = createStockPilotMcp({ ...principal, scopes }, {
    listAssets: async () => ({ assets: [asset], total: 1, catalogTotal: 1, offset: 0,
      nextCursor: null, sources: [], stale: false }),
    getAsset: async () => ({ asset, stale: false }),
    portfolio: async (wallet) => {
      calls.push(`portfolio:${wallet}`);
      return { walletAddress: wallet, funding: { usdc: { mintAddress: saved.fundingMint,
        amount: "12", amountUsd: 12 }, sol: { amount: "0.5" } },
        portfolioValueUsd: 0, positions: [], asOf: "2026-09-23T00:00:00.000Z" };
    },
    createRequest: async (caller, input) => {
      calls.push(`request:${caller.accountId}:${caller.clientId}:${input.assetId}:${input.amountUsd}:${input.clientRequestId}`);
      return saved;
    },
    getRequest: async (caller) => {
      calls.push(`get:${caller.clientId}`);
      return saved;
    },
    listRequests: async (caller) => {
      calls.push(`list:${caller.clientId}`);
      return { requests: [saved], nextCursor: null };
    },
    appUrl: () => new URL("https://stockpilot.endpx.cloud"),
  });
  return { handler, calls };
}

async function rpc(handler: ReturnType<typeof createStockPilotMcp>, method: string, params: object = {}) {
  const response = await handler.fetch(new Request("https://stockpilot.endpx.cloud/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const raw = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? raw.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "{}" : raw;
  const payload = JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

test("official MCP handler exposes only six non-execution tools", async () => {
  const { handler } = fixture();
  const initialized = await rpc(handler, "initialize", {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" },
  });
  assert.ok(initialized.result);
  const listed = await rpc(handler, "tools/list");
  assert.deepEqual(listed.result?.tools?.map((tool) => tool.name).sort(),
    ["get_asset", "get_portfolio", "get_request", "list_assets", "list_requests", "request_investment"]);
  await handler.close();
});

test("MCP asset detail uses the public-market price reader and rejects mismatched identity", async () => {
  const publicAsset: InvestmentAsset = { ...asset, id: `xstocks:${mint}`, provider: "xstocks",
    marketType: "PUBLIC_MARKET_PRODUCT", symbol: "EXx", tokenPriceUsd: 123.45 };
  const lookedUp: string[] = [];
  const readers = {
    readPreStocks: async () => ({ assets: [asset], stale: false }),
    readXStock: async (requestedMint: string) => {
      lookedUp.push(requestedMint);
      return { asset: publicAsset, stale: true };
    },
  };
  const detail = await resolveMcpAsset(publicAsset.id, readers);
  assert.equal(detail.asset?.tokenPriceUsd, 123.45);
  assert.equal(detail.stale, true);
  assert.deepEqual(lookedUp, [mint]);
  assert.equal((await resolveMcpAsset(asset.id, readers)).asset?.id, asset.id);
  assert.deepEqual(lookedUp, [mint]);
  assert.equal((await resolveMcpAsset("xstocks:invalid", readers)).asset, null);
  assert.deepEqual(lookedUp, [mint]);

  const mismatched = { ...readers, readXStock: async () => ({ asset: { ...publicAsset,
    mintAddress: "11111111111111111111111111111111" }, stale: false }) };
  assert.equal((await resolveMcpAsset(publicAsset.id, mismatched)).asset, null);
});

test("MCP list and detail expose indicative prices for both market providers", async () => {
  const publicAsset: InvestmentAsset = { ...asset, id: `xstocks:${mint}`, provider: "xstocks",
    marketType: "PUBLIC_MARKET_PRODUCT", symbol: "EXx", tokenPriceUsd: 123.45, markPriceUsd: undefined };
  const handler = createStockPilotMcp({ ...principal, scopes: ["markets:read"] }, {
    listAssets: async (filter) => {
      const selected = filter?.provider === "xstocks" ? publicAsset : asset;
      return { assets: [selected], total: 1, catalogTotal: 1, offset: 0,
        nextCursor: null, sources: [], stale: false };
    },
    getAsset: async (assetId) => ({ asset: assetId === publicAsset.id ? publicAsset : asset, stale: false }),
  });
  const call = async (name: string, args: object) => {
    const reply = await rpc(handler, "tools/call", { name, arguments: args });
    assert.equal(reply.result?.isError, undefined);
    return JSON.parse(reply.result?.content?.[0].text ?? "{}");
  };
  const privateList = await call("list_assets", { provider: "prestocks", limit: 2 });
  assert.equal(privateList.assets[0].provider, "prestocks");
  assert.equal(privateList.assets[0].tokenPriceUsd, 100);
  const publicList = await call("list_assets", { provider: "xstocks", limit: 2 });
  assert.equal(publicList.assets[0].provider, "xstocks");
  assert.equal(publicList.assets[0].tokenPriceUsd, 123.45);
  const detail = await call("get_asset", { assetId: publicAsset.id });
  assert.equal(detail.asset.tokenPriceUsd, 123.45);
  await handler.close();
});

test("MCP tools bind portfolio and request to server principal; missing scope is denied", async () => {
  const { handler, calls } = fixture();
  const call = (name: string, args: object) => rpc(handler, "tools/call", { name, arguments: args });
  const assets = await call("list_assets", { limit: 5 });
  assert.equal(JSON.parse(assets.result?.content?.[0].text ?? "{}").assets[0].assetId, asset.id);
  const detail = await call("get_asset", { assetId: asset.id });
  assert.equal(JSON.parse(detail.result?.content?.[0].text ?? "{}").asset.canonicalMint, mint);
  const portfolio = await call("get_portfolio", {});
  assert.equal(JSON.parse(portfolio.result?.content?.[0].text ?? "{}").availableUsdc, "12");
  const missingKey = await call("request_investment", { assetId: asset.id, amountUsd: "5" });
  assert.equal(missingKey.result?.isError, true);
  const created = await call("request_investment", { assetId: asset.id, amountUsd: "5", clientRequestId });
  assert.equal(JSON.parse(created.result?.content?.[0].text ?? "{}").status, "PENDING_APPROVAL");
  assert.equal(JSON.parse(created.result?.content?.[0].text ?? "{}").clientRequestId, clientRequestId);
  assert.equal(JSON.parse(created.result?.content?.[0].text ?? "{}").executionAvailable, false);
  assert.ok((await call("get_request", { requestId })).result?.content?.length);
  assert.ok((await call("list_requests", {})).result?.content?.length);
  assert.deepEqual(calls, [
    `portfolio:${principal.walletAddress}`,
    `request:${principal.accountId}:${principal.clientId}:${asset.id}:5:${clientRequestId}`,
    `get:${principal.clientId}`, `list:${principal.clientId}`,
  ]);
  await handler.close();

  const restricted = fixture(["markets:read"]);
  const denied = await rpc(restricted.handler, "tools/call", { name: "request_investment",
    arguments: { assetId: asset.id, amountUsd: "5", clientRequestId } });
  assert.equal(denied.result?.isError, true);
  assert.deepEqual(restricted.calls, []);
  await restricted.handler.close();
});
