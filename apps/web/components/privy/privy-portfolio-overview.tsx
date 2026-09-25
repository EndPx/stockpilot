"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { fetchPortfolio } from "@/components/portfolio-overview";
import { AgentsPreview } from "@/components/control-plane/agents-preview";
import { exchangePrivySession } from "@/lib/privy/client-session";
import { ActivityPreview } from "@/components/control-plane/activity-preview";
import { WalletOverviewCard } from "./wallet-overview-card";

type PortfolioState = { kind: "loading" } | { kind: "ready"; portfolio: Portfolio } | { kind: "error"; message: string };

export function PrivyPortfolioOverview() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<PortfolioState>({ kind: "loading" });
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const controller = new AbortController();
    async function load() {
      setState({ kind: "loading" });
      setWalletAddress(null);
      try {
        const session = await exchangePrivySession(getAccessToken, { signal: controller.signal });
        if (!controller.signal.aborted) setWalletAddress(session.walletAddress);
        const portfolio = await fetchPortfolio(controller.signal);
        if (!controller.signal.aborted) setState(portfolio.walletAddress === session.walletAddress
          ? { kind: "ready", portfolio }
          : { kind: "error", message: "Wallet balances do not match your verified session. No value is shown." });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error", message: "We could not load your wallet balances. Nothing has been replaced with zero." });
      }
    }
    void load();
    return () => controller.abort();
  }, [ready, authenticated, getAccessToken, retry]);

  return (
    <div className="dashboard-stack">
      <header className="app-page-header"><div><h1 className="page-title">Overview</h1><p className="page-description">Your wallet, agents, and recent activity in one place.</p></div></header>
      {!ready ? <section className="surface credential-state" role="status">Preparing your overview…</section> : !authenticated ? (
        <section className="surface empty-surface"><h2 className="text-2xl font-semibold">Your StockPilot portfolio</h2><p className="mt-4">Sign in with Google or email to view your Privy Solana wallet.</p><Link href="/sign-in" className="button mt-6">Sign in</Link></section>
      ) : walletAddress ? <>
        <div className="overview-panels"><ActivityPreview /><AgentsPreview /></div>
        <WalletOverviewCard address={walletAddress} balance={state} retry={() => setRetry((value) => value + 1)} />
      </> : state.kind === "error" ? <section className="surface empty-surface" role="alert"><h2 className="text-xl font-semibold">Overview unavailable</h2><p className="mt-3">{state.message}</p><button type="button" className="button mt-6" onClick={() => setRetry((value) => value + 1)}>Try again</button></section>
        : <section className="surface credential-state" role="status">Verifying your wallet session…</section>}
    </div>
  );
}
