"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { PortfolioLoading, PortfolioView, fetchPortfolio } from "@/components/portfolio-overview";

type PortfolioState = { kind: "loading" } | { kind: "ready"; portfolio: Portfolio } | { kind: "error"; message: string };

export function PrivyPortfolioOverview() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<PortfolioState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const controller = new AbortController();
    async function load() {
      setState({ kind: "loading" });
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Your Privy session has expired. Sign in again.");
        const session = await fetch("/api/auth/privy", {
          method: "POST", headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin", signal: controller.signal,
        });
        if (!session.ok) throw new Error("We could not verify your account and Solana wallet.");
        const portfolio = await fetchPortfolio(controller.signal);
        if (!controller.signal.aborted) setState({ kind: "ready", portfolio });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error", message: "We could not load your wallet balances. Nothing has been replaced with zero." });
      }
    }
    void load();
    return () => controller.abort();
  }, [ready, authenticated, getAccessToken, retry]);

  return (
    <div className="dashboard-stack">
      <header className="app-page-header"><div><p className="eyebrow">Overview</p><h1 className="page-title mt-2">Your portfolio</h1><p className="mt-3 text-sm text-muted">Your Privy Solana wallet on mainnet.</p></div></header>
      {!ready ? <PortfolioLoading /> : !authenticated ? (
        <section className="surface empty-surface"><h2 className="text-2xl font-semibold">Your StockPilot portfolio</h2><p className="mt-4">Sign in with Google or email to view your Privy Solana wallet.</p><Link href="/sign-in" className="button mt-6">Sign in</Link></section>
      ) : state.kind === "ready" ? <PortfolioView portfolio={state.portfolio} /> : state.kind === "error" ? (
        <section className="surface empty-surface" role="alert"><h2 className="text-xl font-semibold">Portfolio unavailable</h2><p className="mt-3">{state.message}</p><button type="button" className="button mt-6" onClick={() => setRetry((value) => value + 1)}>Try again</button></section>
      ) : <PortfolioLoading />}
    </div>
  );
}
