import "server-only";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import { getAuthRuntimeConfig } from "@/lib/auth/config";
import { getPublicMarket, listMarkets, marketRegistry } from "@/lib/markets";
import { getPortfolio } from "@/lib/portfolio";
import { createInvestmentRequest, getClientRequest, listClientRequests, RequestError } from "./requests";
import type { AgentPrincipal } from "./credentials";

type Dependencies = {
  listAssets: typeof listMarkets;
  getAsset: (assetId: string) => Promise<{ asset: Awaited<ReturnType<typeof marketRegistry.getAssetById>>; stale: boolean }>;
  portfolio: typeof getPortfolio;
  createRequest: typeof createInvestmentRequest;
  getRequest: typeof getClientRequest;
  listRequests: typeof listClientRequests;
  appUrl: () => URL;
};

type AssetReaders = {
  readPreStocks: () => Promise<{ assets: InvestmentAsset[]; stale: boolean }>;
  readXStock: (mint: string) => Promise<{ asset: InvestmentAsset | null; stale: boolean }>;
};

/** Use the same cache-backed indicative quote as the public-market detail page. */
export async function resolveMcpAsset(assetId: string, readers: AssetReaders = {
  readPreStocks: () => marketRegistry.getSnapshot("prestocks"),
  readXStock: getPublicMarket,
}): Promise<{ asset: InvestmentAsset | null; stale: boolean }> {
  const match = /^(prestocks|xstocks):([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(assetId);
  if (!match) return { asset: null, stale: false };
  const [, provider, mint] = match;
  if (provider === "xstocks") {
    const selected = await readers.readXStock(mint);
    const asset = selected.asset;
    return { asset: asset?.id === assetId && asset.provider === "xstocks" && asset.mintAddress === mint && asset.canonical
      ? asset : null, stale: selected.stale };
  }
  const snapshot = await readers.readPreStocks();
  return { asset: snapshot.assets.find((asset) => asset.id === assetId && asset.provider === "prestocks" &&
    asset.mintAddress === mint && asset.canonical) ?? null, stale: snapshot.stale };
}

const defaults: Dependencies = {
  listAssets: listMarkets,
  getAsset: resolveMcpAsset,
  portfolio: getPortfolio,
  createRequest: createInvestmentRequest,
  getRequest: getClientRequest,
  listRequests: listClientRequests,
  appUrl: () => getAuthRuntimeConfig().appUrl,
};

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function denied() {
  return { isError: true, content: [{ type: "text" as const, text: "PERMISSION_DENIED: This client lacks the required scope." }] };
}

function failure(error: unknown) {
  const message = error instanceof RequestError ? `${error.code}: ${error.message}` : "STOCKPILOT_UNAVAILABLE: Request could not be completed.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function compactAsset(asset: Awaited<ReturnType<typeof marketRegistry.getAssetById>>) {
  if (!asset) return null;
  return {
    assetId: asset.id, name: asset.name, symbol: asset.symbol,
    provider: asset.provider, marketType: asset.marketType,
    canonicalMint: asset.mintAddress, tokenPriceUsd: asset.tokenPriceUsd,
    markPriceUsd: asset.markPriceUsd ?? null, executionStatus: asset.executionStatus,
    availability: asset.availability?.status ?? "REVIEW_REQUIRED",
    restrictionNote: asset.availability?.reason ?? "Catalog listing is not execution authorization.",
  };
}

export function createStockPilotMcp(principal: AgentPrincipal, overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "stockpilot", version: "1.0.0" });
    const can = (scope: string) => principal.scopes.includes(scope as AgentPrincipal["scopes"][number]);

    server.registerTool("list_assets", {
      description: "Search canonical StockPilot Pre-IPO and public-market assets. Discovery does not authorize trading.",
      inputSchema: z.object({
        query: z.string().max(100).optional(), provider: z.enum(["prestocks", "xstocks"]).optional(),
        marketType: z.enum(["PRE_IPO", "PUBLIC_EQUITY", "ETF", "PUBLIC_MARKET_PRODUCT"]).optional(),
        limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(1600).optional(),
      }).strict(),
    }, async (input) => {
      if (!can("markets:read")) return denied();
      try {
        const page = await deps.listAssets({ ...input, limit: input.limit ?? 25 });
        return result({ assets: page.assets.map(compactAsset), nextCursor: page.nextCursor,
          total: page.total, stale: page.stale, sources: page.sources });
      } catch (error) { return failure(error); }
    });

    server.registerTool("get_asset", {
      description: "Inspect one official catalog asset by its canonical assetId.",
      inputSchema: z.object({ assetId: z.string().min(1).max(100) }).strict(),
    }, async ({ assetId }) => {
      if (!can("markets:read")) return denied();
      try {
        const selected = await deps.getAsset(assetId);
        return result({ asset: compactAsset(selected.asset), stale: selected.stale });
      } catch (error) { return failure(error); }
    });

    server.registerTool("get_portfolio", {
      description: "Read the authenticated StockPilot account's verified Solana wallet balances and PreStocks positions.",
      inputSchema: z.object({}).strict(),
    }, async () => {
      if (!can("portfolio:read")) return denied();
      try {
        const portfolio = await deps.portfolio(principal.walletAddress);
        return result({ asOf: portfolio.asOf, walletAddress: portfolio.walletAddress,
          availableUsdc: portfolio.funding.usdc.amount, networkSol: portfolio.funding.sol.amount,
          privatePositions: portfolio.positions, publicPositionsSupported: false });
      } catch (error) { return failure(error); }
    });

    server.registerTool("request_investment", {
      description: "Create a PreStocks investment REQUEST for human approval. Supply a unique clientRequestId per intent and reuse it for retries. This never prepares, signs or executes a transaction.",
      inputSchema: z.object({ assetId: z.string().min(1).max(100), amountUsd: z.string().min(1).max(40),
        clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/) }).strict(),
    }, async (input) => {
      if (!can("investments:request")) return denied();
      try {
        const request = await deps.createRequest(principal, input);
        const approvalUrl = new URL(`/approvals/${request.id}`, deps.appUrl()).toString();
        return result({ requestId: request.id, clientRequestId: request.clientRequestId, status: request.status, assetId: request.assetId,
          amountUsd: request.amountUsd, approvalUrl, executionAvailable: false });
      } catch (error) { return failure(error); }
    });

    server.registerTool("get_request", {
      description: "Read one request created by this client, including the human approval decision.",
      inputSchema: z.object({ requestId: z.uuid() }).strict(),
    }, async ({ requestId }) => {
      if (!can("requests:read-own")) return denied();
      try { return result({ request: await deps.getRequest(principal, requestId) }); }
      catch (error) { return failure(error); }
    });

    server.registerTool("list_requests", {
      description: "List this client's own investment requests, newest first.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(300).optional() }).strict(),
    }, async ({ limit, cursor }) => {
      if (!can("requests:read-own")) return denied();
      try { return result(await deps.listRequests(principal, limit ?? 25, cursor)); }
      catch (error) { return failure(error); }
    });

    return server;
  });
  return handler;
}
