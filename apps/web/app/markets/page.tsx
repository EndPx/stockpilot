import type { Metadata } from "next";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { DataStatus } from "@/components/data-status";
import { ArrowUpRightIcon, SearchIcon } from "@/components/icons";
import { listAssets } from "@/lib/assets";
import { InvalidAssetInput, parseAssetQuery } from "@/lib/asset-inputs";
import { formatUsd, formatValuation } from "@/lib/format";

export const metadata: Metadata = { title: "Markets" };
export const dynamic = "force-dynamic";

export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  let query: string;
  try {
    query = parseAssetQuery((await searchParams).q);
  } catch (error) {
    if (!(error instanceof InvalidAssetInput)) throw error;
    return <section className="surface empty-surface"><p className="eyebrow">Search error</p><h1 className="page-title mt-2">Check your search</h1><p className="mt-4 text-muted">{error.message}</p><Link href="/markets" className="button mt-6">Back to Markets</Link></section>;
  }
  const { assets, total, meta } = await listAssets(query);
  const highlights = assets.slice(0, 3);

  return (
    <div className="dashboard-stack">
      <header className="app-page-header markets-header">
        <div>
          <p className="eyebrow">Official PreStocks</p>
          <h1 className="page-title mt-2">Markets</h1>
          <p className="page-description">Discover tokenized markets on Solana. Available today: official PreStocks for private-company exposure. Public equities are in development.</p>
        </div>
        <div className="market-count"><strong>{total}</strong><span>{total === 1 ? "company" : "companies"}</span></div>
      </header>

      {!query && highlights.length > 0 && (
        <section aria-labelledby="market-pulse-heading">
          <div className="section-heading-row">
            <h2 id="market-pulse-heading">Market pulse</h2>
            <span>Token Price</span>
          </div>
          <div className="market-reel">
            {highlights.map((asset, index) => (
              <Link key={asset.id} href={`/markets/${encodeURIComponent(asset.symbol)}`} className={index === 0 ? "pulse-card pulse-card-featured" : "pulse-card"}>
                <span className="pulse-card-top"><AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} /><ArrowUpRightIcon /></span>
                <span><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
                <b>{formatUsd(asset.tokenPriceUsd)}</b>
                <span className="pulse-mark">Mark {formatUsd(asset.markPriceUsd)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="market-directory" aria-labelledby="directory-heading">
        <div className="directory-toolbar">
          <div>
            <p className="eyebrow">Directory</p>
            <h2 id="directory-heading">All companies</h2>
          </div>
          <form action="/markets" method="get" role="search" className="market-search">
            <SearchIcon />
            <label htmlFor="company-search" className="sr-only">Find a company</label>
            <input key={query} id="company-search" type="search" name="q" defaultValue={query} maxLength={100} placeholder="Search name or symbol" />
            <button type="submit">Search</button>
          </form>
        </div>

        {assets.length ? (
          <div className="market-list">
            <div className="market-list-head" aria-hidden="true">
              <span>Company</span><span>Token Price</span><span>Mark Price</span><span>Valuation</span><span />
            </div>
            {assets.map((asset) => (
              <Link key={asset.id} href={`/markets/${encodeURIComponent(asset.symbol)}`} className="market-row">
                <span className="market-company">
                  <AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} />
                  <span><strong>{asset.name}</strong><small>{asset.symbol}</small></span>
                </span>
                <span className="market-cell"><small>Token Price</small><strong>{formatUsd(asset.tokenPriceUsd)}</strong></span>
                <span className="market-cell market-cell-secondary"><small>Mark Price</small><strong>{formatUsd(asset.markPriceUsd)}</strong></span>
                <span className="market-cell market-cell-secondary"><small>Valuation</small><strong>{formatValuation(asset.impliedValuationUsd)}</strong></span>
                <ArrowUpRightIcon className="market-row-arrow" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-surface border-0">
            <h3>{total === 0 ? "No PreStocks assets are available right now." : "No companies match your search."}</h3>
            {total > 0 && <><p>Try a company name, symbol, or a shorter keyword.</p><Link href="/markets" className="secondary-button mt-5">Clear search</Link></>}
          </div>
        )}
        <div className="directory-footer">
          <DataStatus {...meta} />
          {query && assets.length > 0 && <Link href="/markets" className="text-link">Clear search</Link>}
        </div>
      </section>

      <p className="market-disclaimer">Token Price reflects the traded token. Mark Price is PreStocks&apos; reference value. Neither is an executable trade quote.</p>
    </div>
  );
}
