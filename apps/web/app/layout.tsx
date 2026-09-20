import type { Metadata } from "next";
import Link from "next/link";
import { SolanaProvider } from "@/providers/solana-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StockPilot", template: "%s | StockPilot" },
  description: "Explore tokenized pre-IPO companies available through PreStocks on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <SolanaProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4">Skip to content</a>
          <header className="border-b border-line bg-white">
            <nav aria-label="Main navigation" className="mx-auto flex h-20 max-w-6xl items-center gap-10 px-5 sm:px-8">
              <Link href="/" className="text-xl font-bold tracking-tight">StockPilot<span className="text-accent">.</span></Link>
              <Link href="/markets" className="flex min-h-11 items-center text-sm font-semibold text-muted hover:text-ink">Markets</Link>
            </nav>
          </header>
          <main id="main" className="page">{children}</main>
          <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-5 pb-8 text-xs text-muted sm:px-8">
            <span>Pre-IPO exposure provided by PreStocks.</span>
            <span>Solana mainnet</span>
          </footer>
        </SolanaProvider>
      </body>
    </html>
  );
}
