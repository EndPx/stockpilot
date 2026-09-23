"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { useEffect, useState } from "react";
import { InvestmentForm } from "@/components/investment-panel";
import { selectSessionWallet, signWithPrivyWallet } from "@/lib/investments/privy-wallet";
import { exchangePrivySession } from "@/lib/privy/client-session";

type SessionState =
  | { kind: "loading" }
  | { kind: "ready"; userId: string; walletAddress: string }
  | { kind: "error"; userId: string };

export function PrivyInvestmentPanel({ asset }: { asset: { symbol: string; name: string } }) {
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
    <aside className="surface investment-panel" aria-labelledby="investment-heading">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Invest</p>
      <h2 id="investment-heading" className="mt-2 text-xl font-semibold">Buy {asset.symbol}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">Invest USDC into this official PreStocks asset through Jupiter.</p>
      <div className="mt-6 border-t border-line pt-6">
        {privyReady && !authenticated ? (
          <p role="alert" className="investment-error mt-0">Sign in to invest with your Privy wallet.</p>
        ) : !privyReady || currentSession.kind === "loading" || !walletsReady ? (
          <p role="status" className="text-sm text-muted">Checking your Privy wallet…</p>
        ) : currentSession.kind === "error" ? (
          <div><p role="alert" className="investment-error mt-0">We could not verify your StockPilot wallet session.</p>
            <button type="button" className="secondary-button mt-4" onClick={() => { setSession({ kind: "loading" }); setRetry((value) => value + 1); }}>Try again</button>
          </div>
        ) : !wallet ? (
          <p role="alert" className="investment-error mt-0">Your Privy wallet does not match the authenticated StockPilot session. Sign in again before investing.</p>
        ) : (
          <InvestmentForm
            key={currentSession.walletAddress}
            asset={asset}
            connectedWalletAddress={wallet.address}
            sessionWalletAddress={currentSession.walletAddress}
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
      <p className="mt-6 border-t border-line pt-5 text-xs leading-5 text-muted">You will review the executable estimate before Privy requests your signature. StockPilot never signs or retries automatically.</p>
    </aside>
  );
}
