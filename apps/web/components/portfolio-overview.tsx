"use client";

import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import type { Portfolio } from "@stockpilot/core/portfolio";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatUsd } from "@/lib/format";
import { shortenAddress } from "@/lib/solana/address";
import { useAuth } from "@/providers/auth-provider";
import { solanaClient } from "@/providers/solana-provider";
import { AssetLogo } from "./asset-logo";
import { WalletButton } from "./wallet/wallet-button";

type PortfolioErrorCode =
  | "UNAUTHENTICATED"
  | "SOLANA_RPC_UNAVAILABLE"
  | "PRESTOCKS_UNAVAILABLE"
  | "PORTFOLIO_UNAVAILABLE";

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "success"; portfolio: Portfolio }
  | { status: "error"; code: PortfolioErrorCode };

function isPortfolio(value: unknown): value is Portfolio {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Portfolio>;
  return typeof item.walletAddress === "string" &&
    typeof item.asOf === "string" &&
    Array.isArray(item.positions) &&
    typeof item.funding === "object" &&
    item.funding !== null;
}

async function fetchPortfolio(signal: AbortSignal): Promise<Portfolio> {
  const response = await fetch("/api/portfolio", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { code?: unknown } }).error?.code
      : undefined;
    if (
      code === "UNAUTHENTICATED" ||
      code === "SOLANA_RPC_UNAVAILABLE" ||
      code === "PRESTOCKS_UNAVAILABLE" ||
      code === "PORTFOLIO_UNAVAILABLE"
    ) {
      throw new PortfolioLoadError(code);
    }
    throw new PortfolioLoadError("PORTFOLIO_UNAVAILABLE");
  }
  const body: unknown = await response.json().catch(() => null);
  const portfolio = typeof body === "object" && body !== null && "portfolio" in body
    ? (body as { portfolio?: unknown }).portfolio
    : undefined;
  if (!isPortfolio(portfolio)) throw new PortfolioLoadError("PORTFOLIO_UNAVAILABLE");
  return portfolio;
}

class PortfolioLoadError extends Error {
  constructor(readonly code: PortfolioErrorCode) {
    super(code);
  }
}

export function PortfolioLoading() {
  return (
    <div role="status" aria-label="Loading portfolio" className="dashboard-stack">
      <div className="surface portfolio-summary-grid">
        {["Portfolio Estimate", "Available to Invest", "Network Balance"].map((label) => (
          <div key={label} className="metric-block">
            <p className="text-sm font-medium text-muted">{label}</p>
            <span className="skeleton-value" aria-hidden="true" />
          </div>
        ))}
      </div>
      <div className="surface p-6">
        <p className="text-sm font-medium text-muted">Investments</p>
        <span className="skeleton-row" aria-hidden="true" />
      </div>
      <span className="sr-only">Loading wallet balances and investments.</span>
    </div>
  );
}

export function PortfolioErrorState({
  code,
  onRetry,
  onSignIn,
}: {
  code: PortfolioErrorCode;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const expired = code === "UNAUTHENTICATED";
  const title = expired
    ? "Your session has expired."
    : code === "PRESTOCKS_UNAVAILABLE"
      ? "We couldn't load current PreStocks information."
      : code === "SOLANA_RPC_UNAVAILABLE"
        ? "We couldn't load your wallet balances."
        : "We couldn't load your portfolio.";
  return (
    <section role="alert" className="surface empty-surface">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
        {expired
          ? "Sign in again to continue viewing this wallet."
          : "Your balances have not been replaced with zeros. Try loading them again."}
      </p>
      <button type="button" className="button mt-6" onClick={expired ? onSignIn : onRetry}>
        {expired ? "Sign In Again" : "Try Again"}
      </button>
    </section>
  );
}

export function PortfolioView({ portfolio }: { portfolio: Portfolio }) {
  const hasAvailableUsdc = portfolio.funding.usdc.amountUsd > 0;
  return (
    <>
      <div className="surface portfolio-summary-grid">
        <div className="metric-block metric-block-primary">
          <p className="text-sm font-medium text-muted">Portfolio Estimate</p>
          <p className="metric-value">{formatUsd(portfolio.portfolioValueUsd)}</p>
          <p className="mt-2 text-xs text-muted">Estimated from current PreStocks token prices</p>
        </div>
        <div className="metric-block">
          <p className="text-sm font-medium text-muted">Available to Invest</p>
          <p className="metric-value">{formatUsd(portfolio.funding.usdc.amountUsd)}</p>
          <p className="mt-2 text-xs text-muted">{portfolio.funding.usdc.amount} USDC</p>
        </div>
        <div className="metric-block">
          <p className="text-sm font-medium text-muted">Network Balance</p>
          <p className="metric-value metric-value-network"><span>{portfolio.funding.sol.amount}</span> <span>SOL</span></p>
          <p className="mt-2 text-xs text-muted">For Solana network activity</p>
        </div>
      </div>

      <section className="surface investment-list" aria-labelledby="investments-heading">
        <div className="surface-header">
          <h2 id="investments-heading" className="text-lg font-semibold">Investments</h2>
          <Link href="/markets" className="text-sm font-semibold text-accent hover:underline">Explore Markets</Link>
        </div>
        {portfolio.positions.length ? (
          <ul className="divide-y divide-line">
            {portfolio.positions.map((position) => (
              <li key={position.mintAddress}>
                <Link href={`/markets/${encodeURIComponent(position.symbol)}`} className="position-row">
                  <span className="flex min-w-0 items-center gap-3">
                    <AssetLogo imageUrl={position.imageUrl} symbol={position.symbol} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{position.name}</span>
                      <span className="mt-1 block text-xs text-muted">{position.symbol}</span>
                    </span>
                  </span>
                  <span className="grid gap-1 text-left sm:text-right">
                    <span className="font-medium tabular-nums">{position.quantity} {position.symbol}</span>
                    <span className="text-sm text-muted tabular-nums">Estimated Value {formatUsd(position.estimatedValueUsd)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-surface border-0">
            <h3 className="text-lg font-semibold">You don&apos;t own any PreStocks yet.</h3>
            <p className="mt-2 text-sm text-muted">
              {hasAvailableUsdc
                ? "You're ready to invest with your available USDC."
                : "Add USDC to this wallet when you're ready to invest."}
            </p>
            <Link href="/markets" className="secondary-button mt-6">Explore Markets</Link>
          </div>
        )}
      </section>
      <p className="mt-5 text-xs leading-6 text-muted">
        Estimates use current PreStocks token prices and are not executable liquidation quotes.
        Updated <time dateTime={portfolio.asOf}>{new Date(portfolio.asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time>.
      </p>
    </>
  );
}

function AuthPrompt({ connected, onSignIn, busy, errorMessage }: {
  connected: boolean;
  onSignIn: () => void;
  busy: boolean;
  errorMessage?: string;
}) {
  return (
    <section className="surface auth-prompt">
      <div className="auth-prompt-mark" aria-hidden="true">SP</div>
      <h2 className="text-2xl font-semibold tracking-tight">Your StockPilot portfolio</h2>
      <p className="mx-auto mt-4 max-w-md leading-7 text-muted">
        Connect and sign in with your Solana wallet to view your investments.
      </p>
      <div className="mt-7 flex justify-center">
        {connected ? (
          <button type="button" className="button" disabled={busy} onClick={onSignIn}>
            {busy ? "Signing In…" : "Sign In"}
          </button>
        ) : <WalletButton />}
      </div>
      {errorMessage && <p role="alert" className="mx-auto mt-5 max-w-md text-sm text-red-700">{errorMessage}</p>}
    </section>
  );
}

export function PortfolioOverview() {
  const auth = useAuth();
  const connected = useConnectedWallet(solanaClient);
  const [refreshKey, setRefreshKey] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    void fetchPortfolio(controller.signal)
      .then((portfolio) => setLoad({ status: "success", portfolio }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          status: "error",
          code: error instanceof PortfolioLoadError ? error.code : "PORTFOLIO_UNAVAILABLE",
        });
      });
    return () => controller.abort();
  }, [auth.status, auth.sessionWalletAddress, refreshKey]);

  const signIn = useCallback(() => { void auth.signIn().catch(() => {}); }, [auth]);

  return (
    <div className="dashboard-stack">
      <header className="app-page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1 className="page-title mt-2">Your portfolio</h1>
          <p className="mt-3 text-sm text-muted">
            {auth.sessionWalletAddress
              ? `Wallet ${shortenAddress(auth.sessionWalletAddress)}`
              : "Official PreStocks held by your authenticated wallet."}
          </p>
        </div>
      </header>

      {auth.status === "loading" ? <PortfolioLoading />
        : auth.status !== "authenticated" ? (
          <AuthPrompt
            connected={Boolean(connected)}
            busy={auth.status === "authenticating"}
            errorMessage={auth.errorMessage}
            onSignIn={signIn}
          />
        ) : load.status === "success" ? <PortfolioView portfolio={load.portfolio} />
          : load.status === "error" ? (
            <PortfolioErrorState
              code={load.code}
              onRetry={() => setRefreshKey((key) => key + 1)}
              onSignIn={signIn}
            />
          ) : <PortfolioLoading />}
    </div>
  );
}
