import type { InvestmentAsset } from "./asset-domain.js";

/** Evidence-based exclusions, not a curated whitelist. Public listing alone does not
 * override StockPilot's explicit PreStocks-only private-exposure requirement.
 * The owner has not approved an exception for publicly listed private-market funds.
 */
export const XSTOCKS_DISCOVERY_EXCLUSIONS = [{
  mint: "Xs7UsqobM3EJgMeHwdAbmDBCZH1G5WTCjatpeYcCr8x",
  issuerId: "3b5de927-b421-48ec-81b1-74c8eec4925f",
  underlyingIsin: "US3608521072",
  reason: "PRIVATE_EXPOSURE_REQUIRES_PRESTOCKS",
  evidenceUrl: "https://xstocks.com/news/xstocks-and-fundrise-partner-to-tokenize-vcx-fund-unlocking-onchain-exposure-to-leading-private-tech-companies",
}] as const;

export function discoveryExclusion(asset: InvestmentAsset) {
  return XSTOCKS_DISCOVERY_EXCLUSIONS.find((entry) => entry.mint === asset.mintAddress || entry.issuerId === asset.metadata?.issuerId || entry.underlyingIsin === asset.metadata?.underlyingIsin) ?? null;
}
