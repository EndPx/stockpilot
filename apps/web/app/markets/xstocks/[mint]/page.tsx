import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress } from "@solana/kit";
import { AssetLogo } from "@/components/asset-logo";
import { CopyMint } from "@/components/copy-mint";
import { MarketChart } from "@/components/market-chart";
import { ArrowLeftIcon, ArrowUpRightIcon } from "@/components/icons";
import { getPublicMarket } from "@/lib/markets";
import { marketLabels } from "@/lib/market-inputs";
export const metadata: Metadata = { title: "Public market product" };
export const dynamic = "force-dynamic";

export default async function PublicMarketPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!isAddress(mint)) notFound();
  let result;
  try { result = await getPublicMarket(mint); } catch {
    return <section className="surface empty-surface"><h1 className="page-title">Product temporarily unavailable</h1><p>We could not verify the current issuer catalog. No transaction was requested.</p><Link href="/markets?group=public" className="secondary-button mt-5">Back to Public Markets</Link></section>;
  }
  const { asset, stale } = result;
  if (!asset) notFound();
  return <div className="asset-page public-asset-page">
    <Link href="/markets?group=public" className="back-link"><ArrowLeftIcon /> Public Markets</Link>
    <header className="asset-hero"><div className="asset-identity"><AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} large /><div><p className="eyebrow">{asset.symbol} / xStocks</p><h1>{asset.name}</h1></div></div><span className="catalog-status">Official issuer catalog</span></header>
    <div className="asset-layout">
      <div className="asset-primary">
        <MarketChart provider="xstocks" mint={asset.mintAddress} symbol={asset.symbol} />
        <dl className="asset-stats"><div><dt>Classification</dt><dd>{marketLabels[asset.marketType]}</dd></div><div><dt>Underlying symbol</dt><dd>{asset.metadata?.underlyingSymbol ?? "Not specified"}</dd></div><div><dt>Network</dt><dd>Solana mainnet</dd></div><div><dt>Provider</dt><dd>xStocks</dd></div></dl>
        <section className="asset-about"><p className="eyebrow">About this product</p><h2>Public-market exposure</h2><p>{asset.description ?? "An official product from the xStocks issuer catalog."}</p><p>{asset.marketType === "PUBLIC_MARKET_PRODUCT" ? "The issuer catalog does not yet establish a more specific instrument classification for this product." : "Classification is based on issuer evidence. Tokenized exposure is not direct share ownership."}</p>{asset.metadata?.classificationSource && <a href={asset.metadata.classificationSource} target="_blank" rel="noopener noreferrer" className="text-link">Classification evidence <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a>}</section>
        <section className="surface token-details"><div><p className="eyebrow">Canonical identity</p><h2>Token details</h2></div><dl><div><dt>Asset ID</dt><dd className="font-mono">{asset.id}</dd></div><div><dt>Solana mint</dt><dd className="font-mono" data-testid="asset-mint">{asset.mintAddress}</dd></div><div><dt>Underlying ISIN</dt><dd>{asset.metadata?.underlyingIsin ?? "Not specified"}</dd></div><div><dt>Product ISIN</dt><dd>{asset.metadata?.productIsin ?? "Not specified"}</dd></div></dl><div className="token-actions"><CopyMint mint={mint} /><a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noopener noreferrer" className="secondary-button">View on Solscan <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a></div></section>
      </div>
      <aside className="surface catalog-readiness"><p className="eyebrow">Discovery only</p><h2>Execution not checked</h2><p>This product is in the official catalog. That does not establish current route availability, token compatibility or your eligibility.</p><p>Public-market investing is not enabled in StockPilot. No transaction can be prepared from this page.</p><a href={asset.availability?.issuerTermsUrl ?? "https://assets.backed.fi/legal-documentation"} target="_blank" rel="noopener noreferrer" className="text-link">Issuer terms &amp; restrictions <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a>{asset.metadata?.sourceUrl && <a href={asset.metadata.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-link">Official catalog record <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a>}{stale && <p className="warning-panel">Showing a previously verified issuer record while the latest update is checked.</p>}</aside>
    </div>
    <p className="risk-note">Issuer, geographic, sanctions and venue restrictions apply. Finding a product or a Jupiter route does not establish legal availability. Investing involves risk.</p>
  </div>;
}
