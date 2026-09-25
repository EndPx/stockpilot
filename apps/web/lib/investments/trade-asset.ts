import "server-only";

import type { AssetProvider, InvestmentAsset } from "@stockpilot/core/asset-registry";
import { marketRegistry } from "@/lib/markets";
import type { InvestmentAuthorization } from "./authorization";
import { InvestmentApiError } from "./errors";

type Snapshot = {
  assets: InvestmentAsset[];
  sources: { provider: AssetProvider; fetchedAt: string; stale: boolean }[];
  stale: boolean;
};

const MAX_CATALOG_AGE_MS = 45_000;
const MAX_REVIEW_AGE_MS = 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5_000;

function recent(iso: string, now: number, maxAge: number): boolean {
  const age = now - Date.parse(iso);
  return Number.isFinite(age) && age >= -MAX_CLOCK_SKEW_MS && age < maxAge;
}

function assertCurrentIssuerSource(snapshot: Snapshot, provider: AssetProvider, now: number): void {
  const source = snapshot.sources.filter((entry) => entry.provider === provider);
  if (snapshot.stale || source.length !== 1 || source[0].stale ||
      !recent(source[0].fetchedAt, now, MAX_CATALOG_AGE_MS)) {
    throw new InvestmentApiError("ASSET_CATALOG_STALE", 503);
  }
}

function assertReviewedAsset(asset: InvestmentAsset, provider: AssetProvider, now: number): void {
  if (asset.provider !== provider || asset.canonical !== true ||
      asset.availability?.status !== "AVAILABLE" ||
      asset.availability.restrictionsComplete !== true ||
      !asset.availability.reviewedAt ||
      !recent(asset.availability.reviewedAt, now, MAX_REVIEW_AGE_MS) ||
      provider === "xstocks" && asset.metadata?.isTradingHalted !== false) {
    throw new InvestmentApiError("ASSET_NOT_ALLOWED", 409,
      "This asset is no longer verified for trading. Prepare a new review.");
  }
}

/**
 * Recheck the issuer's canonical mint and revocation state after the owner has
 * signed but before claiming or submitting an order. Catalog availability is
 * only one guard; it is not a legal or investor-eligibility determination.
 */
export function assertFreshTradeAssetInSnapshot(
  authorization: InvestmentAuthorization,
  snapshot: Snapshot,
  now = Date.now(),
): void {
  const provider = authorization.provider ?? "prestocks";
  const mint = (authorization.side ?? "BUY") === "SELL"
    ? authorization.inputMint : authorization.outputMint;
  assertCurrentIssuerSource(snapshot, provider, now);
  const matches = snapshot.assets.filter((asset) => asset.id === `${provider}:${mint}`);
  const asset = matches[0];
  if (matches.length !== 1 || !asset || asset.provider !== provider ||
      asset.mintAddress !== mint || asset.symbol !== authorization.symbol) {
    throw new InvestmentApiError("ASSET_NOT_ALLOWED", 409,
      "This asset is no longer verified for trading. Prepare a new review.");
  }
  assertReviewedAsset(asset, provider, now);
}

/** Refuse a quote before Jupiter if an issuer symbol has no current review. */
export function assertFreshPreStocksSymbolInSnapshot(symbol: string, snapshot: Snapshot, now = Date.now()): string {
  assertCurrentIssuerSource(snapshot, "prestocks", now);
  const matches = snapshot.assets.filter((asset) => asset.provider === "prestocks" &&
    asset.symbol.toLowerCase() === symbol.toLowerCase());
  if (matches.length === 0) throw new InvestmentApiError("ASSET_NOT_FOUND", 404);
  if (matches.length !== 1) throw new InvestmentApiError("ASSET_NOT_ALLOWED", 409);
  assertReviewedAsset(matches[0], "prestocks", now);
  return matches[0].mintAddress;
}

export async function assertFreshPreStocksSymbol(symbol: string): Promise<string> {
  const snapshot = await marketRegistry.getSnapshot("prestocks");
  return assertFreshPreStocksSymbolInSnapshot(symbol, snapshot);
}

export type InvestorReviewIntent = {
  accountId: string;
  walletAddress: string;
  provider: AssetProvider;
  side: "BUY" | "SELL";
  mintAddress: string;
};

/** No server-owned investor review adapter exists yet. Never infer eligibility from issuer listing. */
export async function assertCurrentInvestorEligibility(_intent: InvestorReviewIntent): Promise<void> {
  throw new InvestmentApiError("ASSET_NOT_ALLOWED", 403,
    "This wallet has no current investor eligibility review. No order was submitted.");
}

export async function assertFreshTradeAsset(authorization: InvestmentAuthorization): Promise<void> {
  const provider = authorization.provider ?? "prestocks";
  const snapshot = await marketRegistry.getSnapshot(provider);
  assertFreshTradeAssetInSnapshot(authorization, snapshot);
}
