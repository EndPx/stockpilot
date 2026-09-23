import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteShell } from "@/components/site-shell";
import { SolanaProvider } from "@/providers/solana-provider";
import { PrivyProvider } from "@/providers/privy-provider";
import { isPrivyMode } from "@/lib/privy/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StockPilot", template: "%s | StockPilot" },
  description: "Explore Stocks and Pre-IPO tokenized products on Solana through official xStocks and PreStocks catalogs. Discovery is live; agent controls are in development.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every HTML response must render with its request-specific CSP nonce.
  await connection();
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {isPrivyMode() ? (
          <PrivyProvider><SiteShell>{children}</SiteShell></PrivyProvider>
        ) : (
          <SolanaProvider><SiteShell>{children}</SiteShell></SolanaProvider>
        )}
      </body>
    </html>
  );
}
