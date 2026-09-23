import Link from "next/link";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import { AssetLogo } from "./asset-logo";
import { ArrowUpRightIcon } from "./icons";
import { marketLabels } from "@/lib/market-inputs";
import { formatUsd } from "@/lib/format";
import { MarketDetailNavigationStatus } from "./market-detail-navigation-status";

export function MarketDirectoryRow({ asset }: { asset: InvestmentAsset }) {
  const href = asset.provider === "prestocks" ? `/markets/${encodeURIComponent(asset.symbol)}` : `/markets/xstocks/${asset.mintAddress}`;
  return <Link prefetch={false} href={href} className="market-row">
    <span className="market-company"><AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} /><span><strong>{asset.name}</strong><small>{asset.symbol}</small></span></span>
    <span className="market-cell market-cell-secondary"><strong>{marketLabels[asset.marketType]}</strong></span>
    <span className="market-cell market-cell-secondary"><strong>{formatUsd(asset.tokenPriceUsd)}</strong></span>
    <span className="market-cell"><small>Execution</small><span className="catalog-status">Not checked</span></span>
    <ArrowUpRightIcon className="market-row-arrow" />
    <MarketDetailNavigationStatus symbol={asset.symbol} />
  </Link>;
}
