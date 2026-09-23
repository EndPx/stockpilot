import type { Metadata } from "next";
import Link from "next/link";
import { RegistryQueryError } from "@stockpilot/core/asset-registry";
import { MarketDirectoryRow } from "@/components/market-directory-row";
import { ArrowUpRightIcon, SearchIcon } from "@/components/icons";
import { listMarkets } from "@/lib/markets";
import { marketHref, parseMarketInputs } from "@/lib/market-inputs";
import { marketSectionLabels } from "@/lib/market-navigation";

export const metadata: Metadata = { title: "Stocks & Pre-IPO", description: "Discover canonical tokenized stocks and pre-IPO products on Solana. Discovery is not execution approval." };
export const dynamic = "force-dynamic";

export default async function MarketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let filter; let page;
  try {
    const requested = await searchParams;
    filter = parseMarketInputs({ ...requested, group: requested.group ?? "private" });
    // Browser pages are always bounded to 30, independently of the API's 100 maximum.
    page = await listMarkets({ ...filter, limit: 30 });
  } catch (error) {
    const invalid = error instanceof RegistryQueryError;
    return <section className="surface empty-surface"><p className="eyebrow">{invalid ? "Search error" : "Catalog unavailable"}</p><h1 className="page-title mt-2">{invalid ? "Check your search" : "Markets need a moment"}</h1><p className="mt-4 text-muted">{invalid ? error.message : "We could not refresh the official catalog. Your wallet and holdings are unchanged."}</p><div className="token-actions mt-6"><Link href="/markets?group=private" className="button">{marketSectionLabels.private}</Link><Link href="/markets?group=public" className="secondary-button">{marketSectionLabels.public}</Link></div></section>;
  }
  const { assets, total, catalogTotal, nextCursor, offset, sources, stale } = page;
  const group = filter.group ?? "private";
  const heading = group === "private" ? marketSectionLabels.private : group === "public" ? marketSectionLabels.public : "Markets";
  const providerName = group === "private" ? "PreStocks" : group === "public" ? "xStocks" : "official issuer catalogs";
  return <div className="dashboard-stack">
    <header className="app-page-header markets-header">
      <div><p className="eyebrow">{providerName} / Solana</p><h1 className="page-title mt-2">{heading}</h1><p className="page-description">{group === "private" ? "Explore official PreStocks private-company exposure." : group === "public" ? "Explore official xStocks public-market products." : "Explore official issuer catalogs on Solana."} Search the catalog or open a product to inspect its source.</p></div>
      <div className="market-count"><strong>{catalogTotal.toLocaleString("en-US")}</strong><span>{group === "private" || group === "public" ? "products in this market" : "catalog products"}</span></div>
    </header>

    <section className="market-directory" aria-labelledby="directory-heading">
      <div className="directory-toolbar">
        <div><p className="eyebrow">{providerName}</p><h2 id="directory-heading">{filter.query ? `${total.toLocaleString("en-US")} ${total === 1 ? "result" : "results"}` : "Explore the catalog"}</h2></div>
        <form action="/markets" method="get" role="search" className="market-search">
          <SearchIcon /><label htmlFor="market-search" className="sr-only">Search Stocks or Pre-IPO products</label>
          <input key={`${group}:${filter.query}`} id="market-search" type="search" name="q" defaultValue={filter.query} maxLength={100} placeholder="Name, symbol or underlying" />
          <input type="hidden" name="group" value={group} />
          {filter.provider && <input type="hidden" name="provider" value={filter.provider} />}
          {filter.marketType && <input type="hidden" name="marketType" value={filter.marketType} />}
          <button type="submit">Search</button>
        </form>
      </div>
      {assets.length ? <div className="catalog-list"><table className={`market-table market-table-${group}`}>
        <caption className="sr-only">{heading} products from the official {providerName} catalog. Prices and valuations are issuer reference data, not executable quotes.</caption>
        <thead><tr>{group === "private" ? <><th scope="col">Product</th><th scope="col">Token price</th><th scope="col">Implied val.</th><th scope="col">Mark price <small>Premium</small></th><th scope="col">Mark val.</th><th scope="col">Address</th><th scope="col"><span className="sr-only">Actions</span></th></> : <><th scope="col">Product</th><th scope="col">Indicative price</th><th scope="col">Classification</th><th scope="col">Underlying</th><th scope="col">Address</th><th scope="col"><span className="sr-only">Actions</span></th></>}</tr></thead>
        <tbody>{assets.map((asset) => <MarketDirectoryRow key={asset.id} asset={asset} />)}</tbody>
      </table></div> : <div className="empty-surface border-0"><h3>No products match your search in {heading}.</h3><p>Try a name, symbol, or a shorter keyword.</p><Link href={marketHref({ group })} className="secondary-button mt-5">Clear search</Link></div>}
      <div className="directory-footer catalog-pagination">
        <span>{total ? `${offset + 1}–${offset + assets.length} of ${total.toLocaleString("en-US")}` : "0 results"}</span>
        <nav aria-label="Catalog pagination">{offset > 0 && <Link className="secondary-button" href={marketHref(filter)}>First page</Link>}{nextCursor && <Link prefetch={false} className="secondary-button" href={marketHref(filter, nextCursor)}>Next page <ArrowUpRightIcon /></Link>}{filter.query && <Link className="text-link" href={marketHref({ group })}>Clear search</Link>}</nav>
      </div>
    </section>
    <div className="catalog-source-note"><p>{stale ? "Showing a previously verified catalog while the latest update is checked." : "Official catalog snapshot."} {sources.map((source) => `${source.provider === "prestocks" ? "PreStocks" : "xStocks"}: ${new Date(source.fetchedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC`).join(" · ")}</p><p>Canonical does not mean executable. Public products include unclassified instruments; issuer terms and restrictions apply. xStocks indicative prices may be cached for up to 10 minutes and are not trade quotes.</p></div>
  </div>;
}
