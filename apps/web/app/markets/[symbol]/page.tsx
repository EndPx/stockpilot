import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetLogo } from "@/components/asset-logo";
import { CopyMint } from "@/components/copy-mint";
import { DataStatus } from "@/components/data-status";
import { ArrowLeftIcon, ArrowUpRightIcon } from "@/components/icons";
import { InvestmentPanel } from "@/components/investment-panel";
import { investmentsEnabled } from "@/lib/investments/config";
import { getAsset } from "@/lib/assets";
import { parseAssetSymbol } from "@/lib/asset-inputs";
import { formatUsd, formatValuation } from "@/lib/format";

export const metadata: Metadata = { title: "Asset details" };
export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try { parseAssetSymbol(symbol); } catch { notFound(); }
  const { asset, meta } = await getAsset(symbol);
  if (!asset) notFound();

  const maxPrice = Math.max(asset.tokenPriceUsd ?? 0, asset.markPriceUsd ?? 0);
  const tokenWidth = maxPrice > 0 && asset.tokenPriceUsd !== null ? (asset.tokenPriceUsd / maxPrice) * 100 : 0;
  const markWidth = maxPrice > 0 && asset.markPriceUsd !== null ? (asset.markPriceUsd / maxPrice) * 100 : 0;

  return (
    <div className="asset-page">
      <Link href="/markets" className="back-link"><ArrowLeftIcon /> Markets</Link>

      <header className="asset-hero">
        <div className="asset-identity">
          <AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} large />
          <div><p className="eyebrow">{asset.symbol}</p><h1>{asset.name}</h1></div>
        </div>
        <div className="asset-price-block">
          <span>Token Price</span>
          <strong>{formatUsd(asset.tokenPriceUsd)}</strong>
          <small>Official PreStocks market data</small>
        </div>
      </header>

      <div className="asset-layout">
        <div className="asset-primary">
          <section className="surface price-reference" aria-labelledby="reference-heading">
            <div className="surface-header">
              <div><p className="eyebrow">Price context</p><h2 id="reference-heading">Token versus reference</h2></div>
              <DataStatus {...meta} />
            </div>
            <div className="price-bars" role="img" aria-label={`Token Price ${formatUsd(asset.tokenPriceUsd)}. Mark Price ${formatUsd(asset.markPriceUsd)}.`}>
              <div className="price-bar-row"><span>Token Price</span><div><i style={{ width: `${tokenWidth}%` }} /></div><strong>{formatUsd(asset.tokenPriceUsd)}</strong></div>
              <div className="price-bar-row price-bar-mark"><span>Mark Price</span><div><i style={{ width: `${markWidth}%` }} /></div><strong>{formatUsd(asset.markPriceUsd)}</strong></div>
            </div>
            <p className="reference-note">This is a current-value comparison, not historical performance or an executable quote.</p>
          </section>

          <dl className="asset-stats">
            <div><dt>Implied Valuation</dt><dd>{formatValuation(asset.impliedValuationUsd)}</dd></div>
            <div><dt>Mark Valuation</dt><dd>{formatValuation(asset.markValuationUsd)}</dd></div>
            <div><dt>Network</dt><dd>Solana mainnet</dd></div>
            <div><dt>Provider</dt><dd>PreStocks</dd></div>
          </dl>

          <section className="asset-about">
            <p className="eyebrow">About</p>
            <h2>Company overview</h2>
            <p>{asset.description ?? "No company description is available from PreStocks yet."}</p>
            {asset.externalUrl && <a href={asset.externalUrl} target="_blank" rel="noopener noreferrer" className="text-link">View on PreStocks <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a>}
          </section>

          <section className="surface token-details">
            <div><p className="eyebrow">On-chain identity</p><h2>Token details</h2></div>
            <dl>
              <div><dt>Mint address</dt><dd className="font-mono" data-testid="asset-mint">{asset.mintAddress}</dd></div>
            </dl>
            <div className="token-actions"><CopyMint mint={asset.mintAddress} /><a href={`https://solscan.io/token/${asset.mintAddress}`} target="_blank" rel="noopener noreferrer" className="secondary-button">View on Solscan <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a></div>
          </section>
        </div>

        {investmentsEnabled() ? <InvestmentPanel asset={{ symbol: asset.symbol, name: asset.name }} /> : (
          <aside className="surface p-6"><p className="eyebrow">Read-only release</p><h2 className="mt-3">Investments are not enabled</h2><p className="mt-4 text-muted">Explore official market data and verified wallet holdings. This deployment cannot prepare or submit investment transactions.</p></aside>
        )}
      </div>

      <p className="risk-note">PreStocks provide economic exposure to private companies and do not necessarily represent direct ownership, shareholder rights, or voting rights. Investing involves risk.</p>
    </div>
  );
}
