import type { Metadata } from "next";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { DataStatus } from "@/components/data-status";
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
    return <section className="surface p-8"><h1 className="page-title">Check your search</h1><p className="mt-4 text-muted">{error.message}</p><Link href="/markets" className="button mt-6">Back to Markets</Link></section>;
  }
  const { assets, total, meta } = await listAssets(query);

  return (
    <>
      <div className="mb-8">
        <h1 className="page-title">Markets</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted">Explore tokenized pre-IPO companies available through PreStocks.</p>
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <form action="/markets" method="get" role="search" className="flex w-full max-w-lg items-end gap-2">
          <div className="flex-1">
            <label htmlFor="company-search" className="mb-2 block text-sm font-medium">Find a company</label>
            <input key={query} id="company-search" type="search" name="q" defaultValue={query} maxLength={100} placeholder="Search companies..." className="min-h-11 w-full rounded-lg border border-line bg-white px-4 py-2 text-sm" />
          </div>
          <button className="secondary-button" type="submit">Search</button>
        </form>
        <p className="text-sm text-muted">{query ? `${assets.length} of ${total}` : total} {total === 1 ? "company" : "companies"}</p>
      </div>
      {assets.length ? (
        <div className="surface overflow-hidden">
          <div role="region" aria-label="Company prices; scroll horizontally on small screens" tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">PreStocks market data. Select a company to view its details.</caption>
              <thead className="border-b border-line bg-slate-50/70 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-6 py-4 text-left font-medium">Company</th>
                  <th scope="col" className="px-4 py-4 text-left font-medium">Symbol</th>
                  <th scope="col" className="px-4 py-4 text-right font-medium">Token Price</th>
                  <th scope="col" className="px-4 py-4 text-right font-medium">Mark Price</th>
                  <th scope="col" className="px-6 py-4 text-right font-medium">Implied Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {assets.map((asset) => (
                  <tr key={asset.id} className="relative hover:bg-slate-50/80 focus-within:bg-indigo-50/50">
                    <th scope="row" className="px-6 py-5 text-left font-medium">
                      <Link href={`/markets/${encodeURIComponent(asset.symbol)}`} className="flex items-center gap-3 after:absolute after:inset-0 after:content-['']">
                        <AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} />
                        <span>{asset.name}</span>
                      </Link>
                    </th>
                    <td className="px-4 py-5 text-xs text-muted">{asset.symbol}</td>
                    <td className="px-4 py-5 text-right font-semibold tabular-nums">{formatUsd(asset.tokenPriceUsd)}</td>
                    <td className="px-4 py-5 text-right tabular-nums">{formatUsd(asset.markPriceUsd)}</td>
                    <td className="px-6 py-5 text-right tabular-nums">{formatValuation(asset.impliedValuationUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <section className="surface px-6 py-14 text-center">
          <h2 className="text-lg font-semibold">{total === 0 ? "No PreStocks assets are available right now." : "No companies match your search."}</h2>
          {total > 0 && <><p className="mt-2 text-sm text-muted">Try a company name, symbol, or keyword.</p><Link href="/markets" className="secondary-button mt-5">Clear search</Link></>}
        </section>
      )}
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <DataStatus {...meta} />
        {query && assets.length > 0 && <Link href="/markets" className="text-sm font-medium text-accent hover:underline">Clear search</Link>}
      </div>
      <p className="mt-8 max-w-3xl text-xs leading-6 text-muted">Token Price reflects the traded token. Mark Price is PreStocks’ reference value. Neither is an executable trade quote.</p>
    </>
  );
}
