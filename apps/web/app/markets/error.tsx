"use client";

import Link from "next/link";

export default function MarketsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section className="surface p-8 sm:p-12" role="alert">
      <h1 className="page-title">We couldn't load the market right now.</h1>
      <p className="mt-4 max-w-xl leading-7 text-muted">Market data is temporarily unavailable. Try again in a moment.</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="button" className="button" onClick={() => retry()}>Try Again</button>
        <Link href="/markets" className="secondary-button">Back to Markets</Link>
      </div>
    </section>
  );
}
