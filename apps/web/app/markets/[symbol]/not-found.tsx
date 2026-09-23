import Link from "next/link";

export default function AssetNotFound() {
  return <section className="surface p-8 sm:p-12"><h1 className="page-title">Asset not found</h1><p className="mt-4 text-muted">The requested PreStocks asset was not found. Browse the current market to find an available company.</p><Link href="/markets" className="button mt-6">Back to Pre-IPO</Link></section>;
}
