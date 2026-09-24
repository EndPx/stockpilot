import Link from "next/link";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import { AssetLogo } from "./asset-logo";
import { ArrowUpRightIcon } from "./icons";
import { marketLabels } from "@/lib/market-inputs";
import { formatUsd, formatValuation } from "@/lib/format";
import { formatMarketPremium, marketPremium } from "@/lib/market-premium";
import { MarketDetailNavigationStatus } from "./market-detail-navigation-status";

function informationUrl(asset: InvestmentAsset): string {
  if (asset.provider !== "prestocks") return "https://xstocks.fi/products";
  try {
    const url = new URL(asset.externalUrl ?? "");
    if ((url.origin === "https://prestocks.com" || url.origin === "https://www.prestocks.com") &&
      !url.username && !url.password && !url.pathname.startsWith("/api/")) return url.toString();
  } catch { /* Fall back to the issuer's public catalog. */ }
  return "https://prestocks.com/products";
}

function MarketActions({ href, informationHref, symbol }: { href: string; informationHref: string; symbol: string }) {
  return <div className="market-table-actions">
    <a href={informationHref} target="_blank" rel="noopener noreferrer" className="market-info-link">Information <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a>
    <Link prefetch={false} href={href} className="market-explore-link">Explore <ArrowUpRightIcon /><MarketDetailNavigationStatus symbol={symbol} /></Link>
  </div>;
}

export function MarketDirectoryRow({ asset }: { asset: InvestmentAsset }) {
  const href = asset.provider === "prestocks" ? `/markets/${encodeURIComponent(asset.symbol)}` : `/markets/xstocks/${asset.mintAddress}`;
  const displayName = asset.name.replace(/\s+(?:PreStocks|xStocks?)$/i, "") || asset.name;
  const informationHref = informationUrl(asset);
  const premium = asset.provider === "prestocks" ? marketPremium(asset.tokenPriceUsd, asset.markPriceUsd) : null;
  return <tr className="market-table-row">
    <th scope="row" className="market-product-cell"><Link prefetch={false} href={href} className="market-company"><AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} /><span><strong>{displayName}</strong><small>{asset.symbol}</small></span><MarketDetailNavigationStatus symbol={asset.symbol} /></Link></th>
    <td data-label={asset.provider === "prestocks" ? "Token price" : "Indicative price"} className="market-number-cell"><strong>{formatUsd(asset.tokenPriceUsd)}</strong></td>
    {asset.provider === "prestocks" ? <>
      <td data-label="Implied valuation" className="market-number-cell market-extra-cell">{formatValuation(asset.impliedValuationUsd ?? null)}</td>
      <td data-label="Mark price" className="market-number-cell market-mark-cell"><strong>{formatUsd(asset.markPriceUsd ?? null)}</strong><small className={premium === null ? "" : premium > 0 ? "market-chart-up" : premium < 0 ? "market-chart-down" : ""}>{premium === null ? "Premium unavailable" : `${formatMarketPremium(premium)} premium`}</small></td>
      <td data-label="Mark valuation" className="market-number-cell market-extra-cell">{formatValuation(asset.markValuationUsd ?? null)}</td>
    </> : <>
      <td data-label="Classification" className="market-text-cell market-extra-cell">{marketLabels[asset.marketType]}</td>
      <td data-label="Underlying" className="market-text-cell market-extra-cell">{asset.metadata?.underlyingSymbol ?? "—"}</td>
    </>}
    <td data-label="Address" className="market-address-cell market-extra-cell"><a href={`https://solscan.io/token/${encodeURIComponent(asset.mintAddress)}`} target="_blank" rel="noopener noreferrer" title={`View ${displayName} token on Solscan`} aria-label={`View ${displayName} Solana token on Solscan (opens in a new tab)`} className="market-contract-link font-mono">{asset.mintAddress.slice(0, 4)}…{asset.mintAddress.slice(-4)} <ArrowUpRightIcon /></a></td>
    <td className="market-actions-cell"><MarketActions href={href} informationHref={informationHref} symbol={asset.symbol} /></td>
  </tr>;
}
