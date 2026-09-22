import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { SolanaProvider } from "@/providers/solana-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StockPilot", template: "%s | StockPilot" },
  description: "Explore tokenized public and private markets on Solana through official PreStocks and xStocks catalogs. Discovery is live; agent controls are in development.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <SolanaProvider>
          <SiteShell>{children}</SiteShell>
        </SolanaProvider>
      </body>
    </html>
  );
}
