import type { Metadata } from "next";
import { PortfolioOverview } from "@/components/portfolio-overview";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return <PortfolioOverview />;
}
