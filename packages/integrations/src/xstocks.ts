import { isAddress } from "@solana/kit";
import type { InvestmentAsset, MarketType } from "./asset-domain.js";
import { XSTOCKS_CLASSIFICATION_EVIDENCE } from "@stockpilot/integrations/xstocks-classification";
import { discoveryExclusion } from "@stockpilot/integrations/xstocks-discovery-policy";
import { readProviderJson } from "@stockpilot/integrations/provider-json";

export const XSTOCKS_API = "https://api.xstocks.fi/api/v2/public/assets";
export const XSTOCKS_TERMS = "https://assets.backed.fi/legal-documentation";
export class XStocksProviderError extends Error {
  constructor(options?: ErrorOptions) { super("Official xStocks catalog is unavailable.", options); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed issuer record.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid issuer text.");
  return value.trim();
}
function optionalText(value: unknown): string | null { return value == null ? null : text(value); }
function imageUrl(value: unknown): string | null {
  if (value == null) return null;
  const url = new URL(text(value, 2000));
  return url.protocol === "https:" ? url.href : null;
}

/** Only called with rows from the official, server-owned HTTPS adapter. */
export function normalizeXStock(value: unknown): InvestmentAsset {
  const row = record(value);
  const issuerId = text(row.id);
  const symbol = text(row.symbol, 100);
  const name = text(row.name);
  if (!Array.isArray(row.deployments) || row.deployments.length > 100) throw new Error("Missing or oversized deployments.");
  const deployments = row.deployments.map(record).filter((entry) => entry.network === "Solana");
  if (deployments.length !== 1) throw new Error("Missing or ambiguous Solana deployment.");
  const mintAddress = text(deployments[0].address);
  if (!isAddress(mintAddress)) throw new Error("Invalid Solana mint.");
  const underlying = row.underlying == null ? {} : record(row.underlying);
  const instrument = optionalText(underlying.type);
  if (instrument && /private|pre.?ipo/i.test(instrument)) throw new Error("Private exposure must use PreStocks.");
  const evidence = XSTOCKS_CLASSIFICATION_EVIDENCE.find((entry) => entry.mint === mintAddress && entry.issuerId === issuerId && entry.productIsin === row.isin && entry.underlyingIsin === underlying.isin);
  if (evidence && instrument && instrument !== "Equity") throw new Error("Conflicting issuer classification evidence.");
  const marketType: MarketType = instrument === "Equity" || evidence ? "PUBLIC_EQUITY" : instrument === "ETF" ? "ETF" : "PUBLIC_MARKET_PRODUCT";
  if (row.isTradingHalted != null && typeof row.isTradingHalted !== "boolean") throw new Error("Invalid halt state.");
  const sourceUrl = `${XSTOCKS_API}/${encodeURIComponent(symbol)}`;
  return {
    id: `xstocks:${mintAddress}`, provider: "xstocks", marketType,
    canonical: true, executionStatus: "UNKNOWN", mintAddress, symbol, name,
    description: row.description == null ? null : text(row.description, 10_000),
    imageUrl: imageUrl(row.logo), tokenPriceUsd: null,
    metadata: {
      issuerId, sourceUrl, classificationSource: evidence?.source ?? (marketType === "PUBLIC_MARKET_PRODUCT" ? null : sourceUrl),
      underlyingSymbol: optionalText(underlying.symbol), underlyingIsin: optionalText(underlying.isin),
      productIsin: optionalText(row.isin), isTradingHalted: typeof row.isTradingHalted === "boolean" ? row.isTradingHalted : null,
    },
    availability: {
      status: "REVIEW_REQUIRED", reason: "Issuer, jurisdiction and venue eligibility require review; a quote is not legal clearance.",
      issuerTermsUrl: XSTOCKS_TERMS, restrictedJurisdictions: ["US"], restrictionsComplete: false, reviewedAt: null,
    },
  };
}

/** Complete-or-fail snapshot, bounded to 3,000 records / 60 seconds. Never uses token search. */
export async function fetchXStocksCatalog(fetcher: typeof fetch = fetch) {
  const assets: InvestmentAsset[] = [];
  const issuerIds = new Set<string>();
  const mints = new Set<string>();
  const signal = AbortSignal.timeout(60_000);
  try {
    async function readPage(page: number) {
      const response = await fetcher(`${XSTOCKS_API}?network=Solana&pageSize=100&page=${page}`, {
        headers: { Accept: "application/json" }, cache: "no-store", redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error("Issuer HTTP failure.");
      const payload = record(await readProviderJson(response));
      const pagination = record(payload.page);
      if (!Array.isArray(payload.nodes) || payload.nodes.length > 100 || pagination.currentPage !== page ||
          typeof pagination.hasNextPage !== "boolean" || (pagination.hasNextPage && !payload.nodes.length)) {
        throw new Error("Malformed issuer pagination.");
      }
      return { nodes: payload.nodes, hasNextPage: pagination.hasNextPage };
    }
    function acceptPage(nodes: unknown[]) {
      for (const row of nodes) {
        const asset = normalizeXStock(row);
        const issuerId = asset.metadata!.issuerId;
        if (issuerIds.has(issuerId) || mints.has(asset.mintAddress)) throw new Error("Duplicate issuer ID or canonical mint.");
        issuerIds.add(issuerId); mints.add(asset.mintAddress); assets.push(asset);
      }
    }
    const first = await readPage(0);
    acceptPage(first.nodes);
    let hasNext = first.hasNextPage;
    // The issuer caps a page at 100. Fetch at most three subsequent pages at a
    // time; any lookahead after a terminal page is ignored, never admitted.
    for (let start = 1; hasNext && start < 30; start += 3) {
      const indexes = Array.from({ length: Math.min(3, 30 - start) }, (_, index) => start + index);
      const batch = await Promise.allSettled(indexes.map(readPage));
      for (const result of batch) {
        if (!hasNext) break;
        if (result.status === "rejected") throw result.reason;
        acceptPage(result.value.nodes);
        hasNext = result.value.hasNextPage;
      }
    }
    if (hasNext) throw new Error("Issuer pagination exceeded safety bound.");
    if (!assets.length) throw new Error("Empty issuer catalog.");
    const excluded = assets.flatMap((asset) => {
      const policy = discoveryExclusion(asset);
      return policy ? [{ assetId: asset.id, symbol: asset.symbol, reason: policy.reason, evidenceUrl: policy.evidenceUrl }] : [];
    });
    return { canonicalCount: assets.length, excluded, assets: assets.filter((asset) => !discoveryExclusion(asset)) };
  } catch (cause) { throw new XStocksProviderError({ cause }); }
}

export async function fetchXStocks(fetcher: typeof fetch = fetch): Promise<InvestmentAsset[]> {
  return (await fetchXStocksCatalog(fetcher)).assets;
}

export class XStocksService {
  private cache?: { assets: InvestmentAsset[]; fetchedAt: number };
  private pending?: Promise<void>;
  private failure?: { error: unknown; retryAt: number };
  constructor(private readonly load = fetchXStocks, private readonly now = Date.now) {}
  async getSnapshot() {
    const age = this.cache ? this.now() - this.cache.fetchedAt : Number.POSITIVE_INFINITY;
    if (this.cache && age < 300_000) {
      return this.snapshot(false);
    }
    if (this.failure && this.now() < this.failure.retryAt) {
      return this.fallback(this.failure.error);
    }
    this.pending ??= this.refresh().finally(() => { this.pending = undefined; });
    if (this.cache && age < 1_800_000) {
      // Discovery can use a bounded verified snapshot while a slow paginated
      // issuer refresh runs. The stale flag keeps it out of eligibility checks.
      void this.pending.catch(() => {});
      return this.snapshot(true);
    }
    try { await this.pending; } catch (error) { return this.fallback(error); }
    return this.snapshot(false);
  }
  private snapshot(stale: boolean) {
    return { assets: structuredClone(this.cache!.assets), fetchedAt: new Date(this.cache!.fetchedAt).toISOString(), stale };
  }
  private fallback(error: unknown) {
    if (!this.cache || this.now() - this.cache.fetchedAt >= 1_800_000) throw error;
    return this.snapshot(true);
  }
  private async refresh(): Promise<void> {
    try {
      const assets = await this.load();
      this.cache = { assets: structuredClone(assets), fetchedAt: this.now() };
      this.failure = undefined;
    } catch (error) {
      this.failure = { error, retryAt: this.now() + 15_000 };
      throw error;
    }
  }
}
