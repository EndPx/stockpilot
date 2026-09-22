import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetLogo } from "@/components/asset-logo";
import { CopyMint } from "@/components/copy-mint";
import { DataStatus } from "@/components/data-status";
import { InvestmentPanel } from "@/components/investment-panel";
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

  const stats = [
    ["Token Price", formatUsd(asset.tokenPriceUsd)],
    ["Mark Price", formatUsd(asset.markPriceUsd)],
    ["Implied Valuation", formatValuation(asset.impliedValuationUsd)],
    ["Mark Valuation", formatValuation(asset.markValuationUsd)],
  ];

  return (
    <>
      <Link href="/markets" className="mb-8 inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-accent">← Markets</Link>
      <div className="mb-8 flex items-center gap-5">
        <AssetLogo imageUrl={asset.imageUrl} symbol={asset.symbol} large />
        <div><p className="mb-2 text-sm font-medium text-muted">{asset.symbol}</p><h1 className="page-title">{asset.name}</h1></div>
      </div>
      <p className="mb-8 text-base leading-7 text-muted">Tokenized pre-IPO exposure provided by PreStocks.</p>
      <dl className="surface grid grid-cols-2 overflow-hidden lg:grid-cols-4">
        {stats.map(([label, value], index) => (
          <div key={label} className={`min-w-0 p-5 sm:p-7 ${index % 2 ? "border-l border-line" : ""} ${index > 1 ? "border-t border-line lg:border-t-0 lg:border-l" : ""}`}>
            <dt className="text-xs leading-5 text-muted sm:text-sm">{label}</dt>
            <dd className="mt-3 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4"><DataStatus {...meta} /></div>
      <p className="mt-3 text-xs leading-6 text-muted">Token Price reflects the traded token. Mark Price is PreStocks’ reference value. These values are not executable trade quotes.</p>
      <div className="asset-investment-layout mt-10">
        <div className="asset-investment-primary grid gap-8">
          <section>
          <h2 className="text-xl font-semibold tracking-tight">About</h2>
          <p className="mt-4 max-w-prose whitespace-pre-line text-sm leading-7 text-muted">{asset.description ?? "No company description is available from PreStocks yet."}</p>
          {asset.externalUrl && <a href={asset.externalUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">View on PreStocks<span className="sr-only"> (opens in a new tab)</span></a>}
          </section>
          <section className="surface self-start p-6">
            <h2 className="text-lg font-semibold">Token Details</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted">Provider</dt><dd>PreStocks</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Network</dt><dd>Solana mainnet</dd></div>
              <div className="border-t border-line pt-4"><dt className="text-muted">Mint</dt><dd className="mt-2 break-all font-mono text-xs leading-6" data-testid="asset-mint">{asset.mintAddress}</dd></div>
            </dl>
            <div className="mt-4"><CopyMint mint={asset.mintAddress} /></div>
            <a href={`https://solscan.io/token/${asset.mintAddress}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">View on Solscan<span className="sr-only"> (opens in a new tab)</span></a>
          </section>
        </div>
        <InvestmentPanel asset={{ symbol: asset.symbol, name: asset.name }} />
      </div>
      <p className="mt-10 max-w-3xl border-t border-line pt-6 text-xs leading-6 text-muted">PreStocks provide economic exposure to private companies and do not necessarily represent direct ownership, shareholder rights, or voting rights. Investing involves risk.</p>
    </>
  );
}
