import Link from "next/link";
import { WalletButton } from "@/components/wallet/wallet-button";

export default function HomePage() {
  return (
    <section className="max-w-2xl py-12 sm:py-20">
      <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Your AI agent for tokenized stocks.</h1>
      <p className="mt-6 max-w-lg text-lg leading-8 text-muted">Invest in official PreStocks through the AI agents you already use. Connect a Solana wallet or browse the live market first.</p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <WalletButton />
        <Link href="/markets" className="secondary-button">Explore Markets</Link>
      </div>
    </section>
  );
}
