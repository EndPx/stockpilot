import { isAddress } from "@solana/kit";
import type { InvestmentAsset } from "./asset-domain.js";
import { readProviderJson } from "@stockpilot/integrations/provider-json";

export const PRESTOCKS_API_URL =
  process.env.PRESTOCKS_API_URL ?? "https://prestocks.com/api/prestocks";
const MAX_ASSETS = 3_000;

export class PreStocksProviderError extends Error {
  constructor(options?: ErrorOptions) {
    super("PreStocks provider request failed.", options);
    this.name = "PreStocksProviderError";
  }
}

export type Asset = InvestmentAsset & {
  id: string;
  provider: "prestocks";
  marketType: "PRE_IPO";
  name: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  externalUrl: string | null;
  mintAddress: string;
  tokenPriceUsd: number | null;
  markPriceUsd: number | null;
  impliedValuationUsd: number | null;
  markValuationUsd: number | null;
  supply: number | null;
};

type PreStocksApiAsset = {
  name?: unknown;
  symbol?: unknown;
  description?: unknown;
  image?: unknown;
  external_url?: unknown;
  contract_address?: unknown;
  tokenPrice?: unknown;
  markPrice?: unknown;
  impliedValuation?: unknown;
  markValuation?: unknown;
  supply?: unknown;
};

function optionalString(value: unknown, maxLength = 500): string | null {
  if (typeof value === "string" && value.length > maxLength) {
    throw new Error("PreStocks response contains oversized text.");
  }
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > 2_000) throw new Error("PreStocks response contains an oversized URL.");
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeAsset(value: unknown): Asset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("PreStocks response contains a non-object asset.");
  }
  const asset = value as PreStocksApiAsset;
  const name = optionalString(asset.name);
  const symbol = optionalString(asset.symbol, 100);
  const mintAddress = optionalString(asset.contract_address, 44);

  if (!name || !symbol || !mintAddress) {
    throw new Error("PreStocks response contains an asset without name, symbol, or contract_address.");
  }
  if (!isAddress(mintAddress)) {
    throw new Error("PreStocks response contains an invalid Solana mint address.");
  }

  return {
    canonical: true,
    executionStatus: "UNKNOWN",
    id: `prestocks:${mintAddress}`,
    provider: "prestocks",
    marketType: "PRE_IPO",
    name,
    symbol,
    description: optionalString(asset.description, 10_000),
    imageUrl: optionalUrl(asset.image),
    externalUrl: optionalUrl(asset.external_url),
    mintAddress,
    tokenPriceUsd: optionalNumber(asset.tokenPrice),
    markPriceUsd: optionalNumber(asset.markPrice),
    impliedValuationUsd: optionalNumber(asset.impliedValuation),
    markValuationUsd: optionalNumber(asset.markValuation),
    supply: optionalNumber(asset.supply),
  };
}

/** Fetches and normalizes the live PreStocks registry. */
export async function fetchPreStocks(fetcher: typeof fetch = fetch): Promise<Asset[]> {
  try {
    const response = await fetcher(PRESTOCKS_API_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`PreStocks API request failed with HTTP ${response.status}.`);
    }

    const payload = await readProviderJson(response);
    return normalizePreStocks(payload);
  } catch (cause) {
    if (cause instanceof PreStocksProviderError) throw cause;
    throw new PreStocksProviderError({ cause });
  }
}

export function normalizePreStocks(payload: unknown): Asset[] {
  if (!Array.isArray(payload)) {
    throw new Error("PreStocks API response is not an array.");
  }
  if (payload.length > MAX_ASSETS) {
    throw new Error("PreStocks API response exceeds the asset limit.");
  }

  return payload.map(normalizeAsset);
}
