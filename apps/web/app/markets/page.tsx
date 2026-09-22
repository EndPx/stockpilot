import type { Metadata } from "next";
import Link from "next/link";
import { RegistryQueryError } from "@stockpilot/core/asset-registry";
import { MarketDirectoryRow } from "@/components/market-directory-row";
import { ArrowUpRightIcon, SearchIcon } from "@/components/icons";
import { listMarkets } from "@/lib/markets";
import { marketHref, parseMarketInputs } from "@/lib/market-inputs";

export const metadata: Metadata = { title: "Markets", description: "Discover canonical public and private market products on Solana. Discovery is not execution approval." };
export const dynamic = "force-dynamic";

export default async function MarketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let filter; let page;
  try {
    filter = parseMarketInputs(await searchParams);
    // Browser pages are always bounded to 30, independently of the API's 100 maximum.
    page = await listMarkets({ ...filter, limit: 30 });
  } catch (error) {
    const invalid = error instanceof RegistryQueryError;
    return <section className="surface empty-surface"><p className="eyebrow">{invalid ? "Search error" : "Catalog unavailable"}</p><h1 className="page-title mt-2">{invalid ? "Check your search" : "Markets need a moment"}</h1><p className="mt-4 text-muted">{invalid ? error.message : "We could not refresh the official catalog. Your wallet and holdings are unchanged."}</p><div className="token-actions mt-6"><Link href="/markets" className="button">Back to Markets</Link><Link href="/markets?group=private" className="secondary-button">Private Markets</Link></div></section>;
  }
  const { assets, total, catalogTotal, nextCursor, offset, sources, stale } = page;
  const group = filter.group ?? "all";
  return <div className="dashboard-stack">
    <header className="app-page-header markets-header">
      <div><p className="eyebrow">Tokenized public &amp; private markets</p><h1 className="page-title mt-2">Markets</h1><p className="page-description">Explore official issuer catalogs on Solana. Find a product, know its source, then review what comes next.</p></div>
      <div className="market-count"><strong>{catalogTotal.toLocaleString("en-US")}</strong><span>catalog products</span></div>
    </header>

    <nav className="catalog-filters" aria-label="Market groups">
      {([['all', 'All'], ['private', 'Private Markets'], ['public', 'Public Markets']] as const).map(([value, label]) => <Link key={value} href={marketHref({ query: filter.query, group: value })} aria-current={group === value ? "page" : undefined}>{label}</Link>)}
    </nav>

    <section className="market-directory" aria-labelledby="directory-heading">
      <div className="directory-toolbar">
        <div><p className="eyebrow">{group === "private" ? "PreStocks" : group === "public" ? "xStocks" : "Issuer-backed discovery"}</p><h2 id="directory-heading">{filter.query ? `${total.toLocaleString("en-US")} ${total === 1 ? "result" : "results"}` : "Explore the catalog"}</h2></div>
        <form action="/markets" method="get" role="search" className="market-search">
          <SearchIcon /><label htmlFor="market-search" className="sr-only">Search stocks, ETFs or private markets</label>
          <input key={`${group}:${filter.query}`} id="market-search" type="search" name="q" defaultValue={filter.query} maxLength={100} placeholder="Name, symbol or underlying" />
          <input type="hidden" name="group" value={group} />
          {filter.provider && <input type="hidden" name="provider" value={filter.provider} />}
          {filter.marketType && <input type="hidden" name="marketType" value={filter.marketType} />}
          <button type="submit">Search</button>
        </form>
      </div>
      {assets.length ? <div className="catalog-list">
        <div className="market-list-head" aria-hidden="true"><span>Product / issuer</span><span>Classification</span><span>Token Price</span><span>Execution</span><span /></div>
        {assets.map((asset) => <MarketDirectoryRow key={asset.id} asset={asset} />)}
      </div> : <div className="empty-surface border-0"><h3>No products match your search.</h3><p>Try a name, symbol, or a shorter keyword.</p><Link href={marketHref({ group })} className="secondary-button mt-5">Clear search</Link></div>}
      <div className="directory-footer catalog-pagination">
        <span>{total ? `${offset + 1}–${offset + assets.length} of ${total.toLocaleString("en-US")}` : "0 results"}</span>
        <nav aria-label="Catalog pagination">{offset > 0 && <Link className="secondary-button" href={marketHref(filter)}>First page</Link>}{nextCursor && <Link prefetch={false} className="secondary-button" href={marketHref(filter, nextCursor)}>Next page <ArrowUpRightIcon /></Link>}{filter.query && <Link className="text-link" href={marketHref({ group })}>Clear search</Link>}</nav>
      </div>
    </section>
    <div className="catalog-source-note"><p>{stale ? "Showing a previously verified catalog; refresh is temporarily unavailable." : "Official catalog snapshots."} {sources.map((source) => `${source.provider === "prestocks" ? "PreStocks" : "xStocks"}: ${new Date(source.fetchedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC`).join(" · ")}</p><p>Canonical does not mean executable. Public products include unclassified instruments; issuer terms and restrictions apply. Prices, where provided, are reference data—not trade quotes.</p></div>
  </div>;
}
