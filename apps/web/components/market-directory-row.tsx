import Link from "next/link";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import { AssetLogo } from "./asset-logo";
import { ArrowUpRightIcon } from "./icons";
import { marketLabels } from "@/lib/market-inputs";
import { formatUsd, formatValuation } from "@/lib/format";
import { formatMarketPremium, marketPremium } from "@/lib/market-premium";
import { MarketDetailNavigationStatus } from "./market-detail-navigation-status";
import { CopyMarketAddress } from "./copy-market-address";

function MarketActions({ href, sourceUrl, symbol }: { href: string; sourceUrl: string | null; symbol: string }) {
  return <div className="market-table-actions">
    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="market-info-link">Information <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a>}
    <Link prefetch={false} href={href} className="market-explore-link">Explore <ArrowUpRightIcon /><MarketDetailNavigationStatus symbol={symbol} /></Link>
  </div>;
}

export function MarketDirectoryRow({ asset }: { asset: InvestmentAsset }) {
  const href = asset.provider === "prestocks" ? `/markets/${encodeURIComponent(asset.symbol)}` : `/markets/xstocks/${asset.mintAddress}`;
  const displayName = asset.name.replace(/\s+(?:PreStocks|xStocks?)$/i, "") || asset.name;
  const sourceUrl = asset.provider === "prestocks" ? asset.externalUrl ?? null : asset.metadata?.sourceUrl ?? null;
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
    <td data-label="Address" className="market-address-cell market-extra-cell"><span title={asset.mintAddress} className="font-mono">{asset.mintAddress.slice(0, 4)}…{asset.mintAddress.slice(-4)}</span><CopyMarketAddress address={asset.mintAddress} name={displayName} /></td>
    <td className="market-actions-cell"><MarketActions href={href} sourceUrl={sourceUrl} symbol={asset.symbol} /></td>
  </tr>;
}
