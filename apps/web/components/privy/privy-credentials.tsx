"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Portfolio } from "@stockpilot/core/portfolio";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchPortfolio, PortfolioLoading, PortfolioView } from "@/components/portfolio-overview";
import { exchangePrivySession } from "@/lib/privy/client-session";
import { PrivyWalletCard } from "./privy-wallet-card";

type WalletSessionState =
  | { kind: "loading" }
  | { kind: "ready"; walletAddress: string }
  | { kind: "error"; message: string };
type PortfolioState =
  | { kind: "loading" }
  | { kind: "ready"; portfolio: Portfolio }
  | { kind: "error" };

function WalletPortfolio({ walletAddress }: { walletAddress: string }) {
  const [state, setState] = useState<PortfolioState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetchPortfolio(controller.signal)
      .then((portfolio) => {
        if (controller.signal.aborted) return;
        // Never pair another wallet's holdings with the verified session address.
        setState(portfolio.walletAddress === walletAddress
          ? { kind: "ready", portfolio }
          : { kind: "error" });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ kind: "error" }); });
    return () => controller.abort();
  }, [walletAddress, retry]);

  if (state.kind === "ready") return <PortfolioView portfolio={state.portfolio} />;
  if (state.kind === "loading") return <PortfolioLoading />;
  return <section className="surface empty-surface" role="alert">
    <h2 className="text-xl font-semibold">Balances and investments unavailable</h2>
    <p className="mt-3">We could not load current balances or investments. Values have not been replaced with zero.</p>
    <button type="button" className="button mt-6" onClick={() => setRetry((value) => value + 1)}>Try again</button>
  </section>;
}

function WalletContent({ ready, authenticated, state, onRetry }: {
  ready: boolean;
  authenticated: boolean;
  state: WalletSessionState;
  onRetry: () => void;
}) {
  if (!ready || (authenticated && state.kind === "loading")) {
    return <section className="surface credential-state" role="status">Checking your Solana wallet…</section>;
  }
  if (!authenticated) {
    return <section className="surface empty-surface">
      <h2 className="text-xl font-semibold">Sign in to view your wallet</h2>
      <p className="mt-3">Your wallet address is available after Google or email sign-in.</p>
      <Link href="/sign-in" className="button mt-6">Sign in</Link>
    </section>;
  }
  if (state.kind === "error") {
    return <section className="surface empty-surface" role="alert">
      <h2 className="text-xl font-semibold">Wallet unavailable</h2>
      <p className="mt-3">{state.message}</p>
      <button type="button" className="button mt-6" onClick={onRetry}>Try again</button>
    </section>;
  }
  if (state.kind === "loading") {
    return <section className="surface credential-state" role="status">Checking your Solana wallet…</section>;
  }
  return <>
    <PrivyWalletCard address={state.walletAddress} />
    <WalletPortfolio walletAddress={state.walletAddress} />
  </>;
}

export function PrivyCredentials() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<WalletSessionState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const controller = new AbortController();
    async function load() {
      setState({ kind: "loading" });
      try {
        const session = await exchangePrivySession(getAccessToken, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ kind: "ready", walletAddress: session.walletAddress });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error", message: "Your Solana wallet could not be verified right now. No wallet was changed." });
      }
    }
    void load();
    return () => controller.abort();
  }, [ready, authenticated, getAccessToken, retry]);

  return <div className="dashboard-stack">
    <header className="app-page-header"><div><h1 className="page-title">Wallet</h1><p className="page-description">Your verified Solana wallet, balances, and investments on mainnet.</p></div></header>
    <WalletContent ready={ready} authenticated={authenticated} state={state} onRetry={() => setRetry((value) => value + 1)} />
  </div>;
}
