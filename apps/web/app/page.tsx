import Link from "next/link";

export default function HomePage() {
  return (
    <section className="max-w-2xl py-12 sm:py-20">
      <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Your AI agent for tokenized stocks.</h1>
      <p className="mt-6 max-w-lg text-lg leading-8 text-muted">Core execution path proven on Solana. Explore the companies available through PreStocks.</p>
      <Link href="/markets" className="button mt-8">Explore Markets</Link>
    </section>
  );
}
