import type { Metadata } from "next";
import { PortfolioOverview } from "@/components/portfolio-overview";
import Link from "next/link";
import { isAuthEnabled } from "@/lib/auth/config";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  if (!isAuthEnabled()) return <section className="surface empty-surface"><p className="eyebrow">Read-only release</p><h1 className="page-title mt-2">Explore StockPilot</h1><p className="mt-4 text-muted">Wallet sign-in is not enabled on this deployment. Markets are available without connecting or signing anything.</p><Link className="button mt-6" href="/markets">Explore Markets</Link></section>;
  return <PortfolioOverview />;
}
