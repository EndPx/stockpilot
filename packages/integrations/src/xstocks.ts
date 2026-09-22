import { isAddress } from "@solana/kit";
import type { InvestmentAsset, MarketType } from "./asset-domain.js";
import { XSTOCKS_CLASSIFICATION_EVIDENCE } from "@stockpilot/integrations/xstocks-classification";

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
  if (!Array.isArray(row.deployments)) throw new Error("Missing deployments.");
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
export async function fetchXStocks(fetcher: typeof fetch = fetch): Promise<InvestmentAsset[]> {
  const assets: InvestmentAsset[] = [];
  const issuerIds = new Set<string>();
  const mints = new Set<string>();
  const signal = AbortSignal.timeout(60_000);
  try {
    for (let page = 0; page < 30; page++) {
      const response = await fetcher(`${XSTOCKS_API}?network=Solana&pageSize=100&page=${page}`, {
        headers: { Accept: "application/json" }, cache: "no-store", redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error("Issuer HTTP failure.");
      const payload = record(await response.json());
      const pagination = record(payload.page);
      if (!Array.isArray(payload.nodes) || payload.nodes.length > 100 || pagination.currentPage !== page ||
          typeof pagination.hasNextPage !== "boolean" || (pagination.hasNextPage && !payload.nodes.length)) {
        throw new Error("Malformed issuer pagination.");
      }
      for (const row of payload.nodes) {
        const asset = normalizeXStock(row);
        const issuerId = asset.metadata!.issuerId;
        if (issuerIds.has(issuerId) || mints.has(asset.mintAddress)) throw new Error("Duplicate issuer ID or canonical mint.");
        issuerIds.add(issuerId); mints.add(asset.mintAddress); assets.push(asset);
      }
      if (!pagination.hasNextPage) {
        if (!assets.length) throw new Error("Empty issuer catalog.");
        return assets;
      }
    }
    throw new Error("Issuer pagination exceeded safety bound.");
  } catch (cause) { throw new XStocksProviderError({ cause }); }
}

export class XStocksService {
  private cache?: { assets: InvestmentAsset[]; fetchedAt: number };
  private pending?: Promise<void>;
  constructor(private readonly load = fetchXStocks, private readonly now = Date.now) {}
  async getSnapshot() {
    let stale = false;
    if (!this.cache || this.now() - this.cache.fetchedAt >= 300_000) {
      this.pending ??= this.load().then((assets) => { this.cache = { assets: structuredClone(assets), fetchedAt: this.now() }; }).finally(() => { this.pending = undefined; });
      try { await this.pending; } catch (error) {
        if (!this.cache || this.now() - this.cache.fetchedAt >= 1_800_000) throw error;
        stale = true;
      }
    }
    return { assets: structuredClone(this.cache!.assets), fetchedAt: new Date(this.cache!.fetchedAt).toISOString(), stale };
  }
}
