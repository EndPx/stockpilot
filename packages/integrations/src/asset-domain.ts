import { isAddress } from "@solana/kit";

/** Provider-independent normalized values. Provider adapters own provenance. */
export type MarketType = "PRE_IPO" | "PUBLIC_EQUITY" | "ETF" | "PUBLIC_MARKET_PRODUCT";
export type ExecutionStatus = "UNKNOWN" | "EXECUTABLE" | "RESTRICTED" | "UNAVAILABLE" | "UNSUPPORTED";
export type AssetProvider = "prestocks" | "xstocks";
export type MarketClassification =
  | { marketType: "PRE_IPO"; provider: "prestocks" }
  | { marketType: "PUBLIC_EQUITY" | "ETF" | "PUBLIC_MARKET_PRODUCT"; provider: "xstocks" };

export type AssetAvailability = {
  status: "REVIEW_REQUIRED" | "AVAILABLE" | "RESTRICTED" | "UNAVAILABLE";
  reason: string | null;
  issuerTermsUrl: string | null;
  restrictedJurisdictions: string[];
  restrictionsComplete: boolean;
  reviewedAt: string | null;
};

export type InvestmentAsset = MarketClassification & {
  canonical: true;
  /** Catalogs contain discovery only. Readiness lives in expiring validation results. */
  executionStatus: "UNKNOWN";
  id: string;
  name: string;
  symbol: string;
  mintAddress: string;
  description: string | null;
  imageUrl: string | null;
  tokenPriceUsd: number | null;
  /** Issuer-provided PreStocks reference fields; absent for xStocks. */
  markPriceUsd?: number | null;
  impliedValuationUsd?: number | null;
  markValuationUsd?: number | null;
  externalUrl?: string | null;
  metadata?: {
    issuerId: string;
    sourceUrl: string;
    classificationSource: string | null;
    underlyingSymbol: string | null;
    underlyingIsin: string | null;
    productIsin: string | null;
    isTradingHalted: boolean | null;
  };
  /** Absent metadata means unknown, never permission to invest. */
  availability?: AssetAvailability;
};

/** Bounty invariant, not issuer verification or user eligibility authorization. */
export function isSupportedClassification(value: { marketType?: unknown; provider?: unknown }): value is MarketClassification {
  return (value.marketType === "PRE_IPO" && value.provider === "prestocks") ||
    (["PUBLIC_EQUITY", "ETF", "PUBLIC_MARKET_PRODUCT"].includes(String(value.marketType)) && value.provider === "xstocks");
}

export function assertAssetIdentity(asset: InvestmentAsset): void {
  if (!isSupportedClassification(asset) || asset.canonical !== true || asset.executionStatus !== "UNKNOWN" || !isAddress(asset.mintAddress) ||
      asset.id !== `${asset.provider}:${asset.mintAddress}`) {
    throw new Error("Unsupported asset classification or canonical identity.");
  }
  if (asset.provider === "xstocks" && asset.marketType !== "PUBLIC_MARKET_PRODUCT" && !asset.metadata?.classificationSource) {
    throw new Error("Public instrument classification requires issuer evidence.");
  }
}
