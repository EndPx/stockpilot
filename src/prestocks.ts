export const PRESTOCKS_API_URL =
  process.env.PRESTOCKS_API_URL ?? "https://prestocks.com/api/prestocks";

export type PreStocksAsset = {
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeAsset(asset: PreStocksApiAsset): PreStocksAsset {
  const name = optionalString(asset.name);
  const symbol = optionalString(asset.symbol);
  const mintAddress = optionalString(asset.contract_address);

  if (!name || !symbol || !mintAddress) {
    throw new Error("PreStocks response contains an asset without name, symbol, or contract_address.");
  }

  return {
    name,
    symbol,
    description: optionalString(asset.description),
    imageUrl: optionalString(asset.image),
    externalUrl: optionalString(asset.external_url),
    mintAddress,
    tokenPriceUsd: optionalNumber(asset.tokenPrice),
    markPriceUsd: optionalNumber(asset.markPrice),
    impliedValuationUsd: optionalNumber(asset.impliedValuation),
    markValuationUsd: optionalNumber(asset.markValuation),
    supply: optionalNumber(asset.supply),
  };
}

/** Fetches and normalizes the live PreStocks registry. */
export async function fetchPreStocks(): Promise<PreStocksAsset[]> {
  const response = await fetch(PRESTOCKS_API_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`PreStocks API request failed with HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("PreStocks API response is not an array.");
  }

  return payload.map((asset) => normalizeAsset(asset as PreStocksApiAsset));
}
