/** Provider-independent normalized values. Provider adapters own provenance. */
export type MarketType = "PRE_IPO" | "PUBLIC_EQUITY";
export type AssetProvider = "prestocks" | "xstocks";
export type MarketClassification =
  | { marketType: "PRE_IPO"; provider: "prestocks" }
  | { marketType: "PUBLIC_EQUITY"; provider: "xstocks" };

export type AssetAvailability = {
  status: "REVIEW_REQUIRED" | "AVAILABLE" | "RESTRICTED" | "UNAVAILABLE";
  reason: string | null;
  issuerTermsUrl: string | null;
  restrictedJurisdictions: string[];
  restrictionsComplete: boolean;
  reviewedAt: string | null;
};

export type InvestmentAsset = MarketClassification & {
  id: string;
  name: string;
  symbol: string;
  mintAddress: string;
  description: string | null;
  imageUrl: string | null;
  tokenPriceUsd: number | null;
  /** Absent metadata means unknown, never permission to invest. */
  availability?: AssetAvailability;
};

/** Bounty invariant, not issuer verification or user eligibility authorization. */
export function isSupportedClassification(value: { marketType?: unknown; provider?: unknown }): value is MarketClassification {
  return (value.marketType === "PRE_IPO" && value.provider === "prestocks") ||
    (value.marketType === "PUBLIC_EQUITY" && value.provider === "xstocks");
}
