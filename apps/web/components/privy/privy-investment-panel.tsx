"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { useEffect, useState } from "react";
import { DemoTradeForm } from "@/components/demo-trade-form";
import { selectSessionWallet, signWithPrivyWallet } from "@/lib/investments/privy-wallet";
import { exchangePrivySession } from "@/lib/privy/client-session";

type SessionState =
  | { kind: "loading" }
  | { kind: "ready"; userId: string; walletAddress: string }
  | { kind: "error"; userId: string };

export function PrivyInvestmentPanel({ asset }: { asset: { symbol: string; name: string; mintAddress: string; provider: "prestocks" | "xstocks" } }) {
  const { ready: privyReady, authenticated, user, getAccessToken } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!privyReady || !authenticated || !user) return;
    const controller = new AbortController();
    void exchangePrivySession(getAccessToken, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setSession({ kind: "ready", userId: user.id, walletAddress: value.walletAddress });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ kind: "error", userId: user.id });
      });
    return () => controller.abort();
  }, [privyReady, authenticated, user, getAccessToken, retry]);

  const currentSession = session.kind !== "loading" && session.userId === user?.id ? session : { kind: "loading" } as const;
  const wallet = currentSession.kind === "ready" && walletsReady
    ? selectSessionWallet(wallets, currentSession.walletAddress)
    : null;

  return (
    <div>
        {privyReady && !authenticated ? (
          <aside className="surface investment-panel"><p role="alert" className="investment-error mt-0">Sign in to trade with your Privy wallet.</p></aside>
        ) : !privyReady || currentSession.kind === "loading" || !walletsReady ? (
          <aside className="surface investment-panel"><p role="status" className="text-sm text-muted">Checking your Privy wallet…</p></aside>
        ) : currentSession.kind === "error" ? (
          <aside className="surface investment-panel"><p role="alert" className="investment-error mt-0">We could not verify your StockPilot wallet session.</p>
            <button type="button" className="secondary-button mt-4" onClick={() => { setSession({ kind: "loading" }); setRetry((value) => value + 1); }}>Try again</button>
          </aside>
        ) : !wallet ? (
          <aside className="surface investment-panel"><p role="alert" className="investment-error mt-0">Your Privy wallet does not match the authenticated StockPilot session. Sign in again before trading.</p></aside>
        ) : (
          <DemoTradeForm
            key={currentSession.walletAddress}
            asset={asset}
            walletAddress={currentSession.walletAddress}
            sign={(transaction) => signWithPrivyWallet({
              transaction,
              wallet,
              signTransaction: ({ transaction: bytes, wallet: signerWallet }) => signTransaction({
                transaction: bytes,
                wallet: signerWallet,
                chain: "solana:mainnet",
              }),
            })}
          />
        )}
      </div>
  );
}
