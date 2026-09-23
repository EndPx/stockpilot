"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { exchangePrivySession } from "@/lib/privy/client-session";
import { PrivyWalletCard } from "./privy-wallet-card";

type CredentialState =
  | { kind: "loading" }
  | { kind: "ready"; walletAddress: string }
  | { kind: "error"; message: string };

export function PrivyCredentials() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<CredentialState>({ kind: "loading" });
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

  return (
    <div className="dashboard-stack">
      <header className="app-page-header"><div><p className="eyebrow">Account</p><h1 className="page-title mt-2">Credentials</h1><p className="page-description">Your verified Solana wallet identity. Only its public address is shown here.</p></div></header>
      {!ready || (authenticated && state.kind === "loading") ? (
        <section className="surface credential-state" role="status">Checking your Solana wallet…</section>
      ) : !authenticated ? (
        <section className="surface empty-surface"><h2 className="text-xl font-semibold">Sign in to view your wallet</h2><p className="mt-3">Your wallet address is available after Google or email sign-in.</p><Link href="/sign-in" className="button mt-6">Sign in</Link></section>
      ) : state.kind === "ready" ? (
        <>
          <PrivyWalletCard address={state.walletAddress} />
          <p className="credential-note">This is your StockPilot wallet. Assets in a previous Phantom wallet do not move here automatically. Private keys and agent permissions are not exposed on this page.</p>
        </>
      ) : (
        <section className="surface empty-surface" role="alert"><h2 className="text-xl font-semibold">Wallet unavailable</h2><p className="mt-3">{state.kind === "error" ? state.message : "Your wallet is not ready yet."}</p><button type="button" className="button mt-6" onClick={() => setRetry((value) => value + 1)}>Try again</button></section>
      )}
    </div>
  );
}
