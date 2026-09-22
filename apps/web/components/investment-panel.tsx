"use client";

import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useSignTransaction } from "@solana/react";
import type { Portfolio } from "@stockpilot/core/portfolio";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  InvestmentClientError,
  readInvestmentApiResponse,
  runInvestmentApproval,
} from "@/lib/investments/client";
import type { InvestmentExecutionResponse, PreparedInvestmentResponse } from "@/lib/investments/types";
import { SOLANA_CHAIN } from "@/lib/solana/config";
import { useAuth } from "@/providers/auth-provider";
import { solanaClient, type StockPilotSolanaClient } from "@/providers/solana-provider";
import { WalletButton } from "./wallet/wallet-button";

type ConnectedAccount = NonNullable<ReturnType<StockPilotSolanaClient["wallet"]["getState"]>["connected"]>["account"];
type InvestmentAsset = { symbol: string; name: string };
type Workflow = "idle" | "preparing" | "review" | "signing" | "submitting" | "confirming" | "success" | "failure";

function isWalletRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && (
    ("name" in error && error.name === "AbortError") ||
    ("code" in error && error.code === 4001)
  );
}

function isPortfolio(value: unknown): value is Portfolio {
  if (!value || typeof value !== "object") return false;
  const portfolio = value as Partial<Portfolio>;
  return typeof portfolio.walletAddress === "string" &&
    typeof portfolio.funding === "object" && portfolio.funding !== null &&
    Array.isArray(portfolio.positions);
}

async function fetchPortfolio(signal?: AbortSignal): Promise<Portfolio> {
  const response = await fetch("/api/portfolio", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
    throw new InvestmentClientError(
      typeof error?.code === "string" ? error.code : "PROVIDER_UNAVAILABLE",
      typeof error?.message === "string" ? error.message : "We couldn't load your available USDC.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  const portfolio = body && typeof body === "object" && "portfolio" in body
    ? (body as { portfolio?: unknown }).portfolio
    : undefined;
  if (!isPortfolio(portfolio)) throw new InvestmentClientError("PROVIDER_UNAVAILABLE", "We couldn't load your available USDC.");
  return portfolio;
}

function errorCopy(error: unknown): { code: string; message: string } {
  if (error instanceof InvestmentClientError) return { code: error.code, message: error.message };
  return { code: "PROVIDER_UNAVAILABLE", message: "StockPilot could not complete this investment. Try again." };
}

function PreparingLabel({ workflow }: { workflow: Workflow }) {
  const label = workflow === "preparing" ? "Preparing investment…"
    : workflow === "signing" ? "Waiting for wallet approval…"
      : workflow === "submitting" ? "Submitting investment…"
        : workflow === "confirming" ? "Confirming on Solana…"
          : "Review Investment";
  return <>{label}</>;
}

function AuthenticatedInvestmentForm({
  account,
  asset,
  sessionWalletAddress,
}: {
  account: ConnectedAccount;
  asset: InvestmentAsset;
  sessionWalletAddress: string;
}) {
  const signTransaction = useSignTransaction(account, SOLANA_CHAIN);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [amount, setAmount] = useState("");
  const [portfolio, setPortfolio] = useState<Portfolio>();
  const [portfolioError, setPortfolioError] = useState<string>();
  const [workflow, setWorkflow] = useState<Workflow>("idle");
  const [prepared, setPrepared] = useState<PreparedInvestmentResponse>();
  const [execution, setExecution] = useState<InvestmentExecutionResponse>();
  const [error, setError] = useState<{ code: string; message: string }>();
  const busy = ["preparing", "signing", "submitting", "confirming"].includes(workflow);

  const loadPortfolio = useCallback(async (signal?: AbortSignal) => {
    const result = await fetchPortfolio(signal);
    setPortfolio(result);
    setPortfolioError(undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPortfolio(controller.signal).catch((loadError: unknown) => {
      if (!controller.signal.aborted) setPortfolioError(errorCopy(loadError).message);
    });
    return () => controller.abort();
  }, [loadPortfolio, sessionWalletAddress]);

  useEffect(() => {
    if (prepared && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [prepared]);

  function closeDialog() {
    if (!busy) dialogRef.current?.close();
  }

  async function prepare() {
    setWorkflow("preparing");
    setError(undefined);
    setExecution(undefined);
    try {
      const response = await fetch("/api/investments/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ symbol: asset.symbol, amountUsd: amount }),
      });
      const next = await readInvestmentApiResponse<PreparedInvestmentResponse>(response);
      setPrepared(next);
      setWorkflow("review");
    } catch (prepareError) {
      setError(errorCopy(prepareError));
      setWorkflow("failure");
    }
  }

  async function executeSigned(signedTransaction: string, investmentToken: string) {
    setWorkflow("submitting");
    const responsePromise = fetch("/api/investments/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ signedTransaction, investmentToken }),
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    setWorkflow("confirming");
    return readInvestmentApiResponse<InvestmentExecutionResponse>(await responsePromise);
  }

  async function approve() {
    if (!prepared) return;
    if (Date.parse(prepared.investment.expiresAt) <= Date.now()) {
      setError({ code: "JUPITER_ORDER_EXPIRED", message: "The investment quote expired. Prepare a new review." });
      setWorkflow("review");
      return;
    }
    setError(undefined);
    setWorkflow("signing");
    try {
      const result = await runInvestmentApproval({
        prepared,
        connectedWalletAddress: account.address,
        sessionWalletAddress,
        sign: async (transaction) => (await signTransaction({ transaction })).signedTransaction,
        execute: executeSigned,
        refreshPortfolio: () => loadPortfolio(),
      });
      setExecution(result);
      setWorkflow("success");
    } catch (approvalError) {
      if (isWalletRejection(approvalError)) {
        setError({
          code: "WALLET_SIGNATURE_REJECTED",
          message: "Investment cancelled. No transaction was submitted.",
        });
        setWorkflow("review");
      } else {
        setError(errorCopy(approvalError));
        setWorkflow("failure");
      }
    }
  }

  const expired = prepared ? Date.parse(prepared.investment.expiresAt) <= Date.now() : false;

  return (
    <>
      <form onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
        <label htmlFor="investment-amount" className="text-sm font-medium">Amount</label>
        <div className="investment-amount-field mt-2">
          <span aria-hidden="true">$</span>
          <input
            id="investment-amount"
            name="amountUsd"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            disabled={busy}
            onChange={(event) => setAmount(event.target.value)}
          />
          <button
            type="button"
            className="investment-max"
            disabled={!portfolio || busy}
            onClick={() => setAmount(portfolio?.funding.usdc.amount ?? "")}
          >
            Max
          </button>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">Pay with</span><span className="font-semibold">USDC</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">Available to Invest</span>
          <span className="font-medium tabular-nums">{portfolio ? `${portfolio.funding.usdc.amount} USDC` : "Loading…"}</span>
        </div>
        {portfolioError && <p role="alert" className="investment-error">{portfolioError}</p>}
        {error && !prepared && <p role="alert" className="investment-error">{error.message}</p>}
        <button
          ref={reviewButtonRef}
          type="submit"
          className="button mt-6 w-full"
          disabled={busy || !portfolio || !amount || Boolean(portfolioError)}
        >
          <PreparingLabel workflow={workflow} />
        </button>
      </form>

      <dialog
        ref={dialogRef}
        className="investment-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => { if (busy) event.preventDefault(); }}
        onClose={() => {
          if (workflow !== "success") {
            setPrepared(undefined);
            setWorkflow("idle");
            setError(undefined);
          }
          reviewButtonRef.current?.focus();
        }}
      >
        <div className="relative p-6 sm:p-7">
          {!busy && (
            <button type="button" className="wallet-dialog-close" aria-label="Close investment review" onClick={closeDialog}>×</button>
          )}
          {workflow === "success" && execution ? (
            <>
              <p className="wallet-dialog-kicker">Transaction confirmed</p>
              <h2 id={titleId} className="wallet-dialog-title">Investment confirmed</h2>
              <p className="mt-3 text-sm leading-6 text-muted">Your confirmed amounts come from Jupiter&apos;s execution result.</p>
              <dl className="investment-review-list mt-6">
                <div><dt>Invested</dt><dd>{execution.execution.inputAmountUsd} USDC</dd></div>
                <div><dt>Received</dt><dd>{execution.execution.outputAmount} {execution.execution.symbol}</dd></div>
                <div><dt>Transaction</dt><dd className="break-all font-mono text-xs">{execution.execution.signature}</dd></div>
              </dl>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <a className="secondary-button" href={execution.execution.solscanUrl} target="_blank" rel="noopener noreferrer">View on Solscan<span className="sr-only"> (opens in a new tab)</span></a>
                <Link className="button" href="/app">View Portfolio</Link>
              </div>
            </>
          ) : prepared ? (
            <>
              <p className="wallet-dialog-kicker">Review Investment</p>
              <h2 id={titleId} className="wallet-dialog-title">{prepared.investment.asset.name}</h2>
              <p className="mt-2 text-sm text-muted">{prepared.investment.asset.symbol} · Solana mainnet</p>
              <dl className="investment-review-list mt-6">
                <div><dt>You invest</dt><dd>{prepared.investment.inputAmountUsd} USDC</dd></div>
                <div><dt>Estimated received</dt><dd>{prepared.investment.estimatedOutputAmount} {prepared.investment.asset.symbol}</dd></div>
                <div><dt>Execution</dt><dd>Jupiter</dd></div>
                <div><dt>Router</dt><dd>{prepared.investment.router}</dd></div>
                {prepared.investment.feeBps !== null && <div><dt>Jupiter fee</dt><dd>{prepared.investment.feeBps / 100}%</dd></div>}
                {prepared.investment.priceImpactPct !== null && <div><dt>Price impact</dt><dd>{prepared.investment.priceImpactPct}%</dd></div>}
                <div><dt>StockPilot fee</dt><dd>$0</dd></div>
                <div><dt>Destination</dt><dd className="max-w-48 break-all font-mono text-xs">{prepared.investment.walletAddress}</dd></div>
                <div><dt>Review expires</dt><dd><time dateTime={prepared.investment.expiresAt}>{new Date(prepared.investment.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></dd></div>
              </dl>
              {error && <p role="alert" className="investment-error">{error.message}</p>}
              <p className="mt-5 text-xs leading-5 text-muted">Estimated output comes from this Jupiter order, not the reference Token Price.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Cancel</button>
                {error?.code === "JUPITER_ORDER_EXPIRED" || expired || workflow === "failure" ? (
                  <button type="button" className="button" disabled={busy} onClick={() => void prepare()}>Refresh Review</button>
                ) : (
                  <button type="button" className="button" disabled={busy} onClick={() => void approve()}>
                    {workflow === "review" ? "Approve in Wallet" : <PreparingLabel workflow={workflow} />}
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

export function InvestmentPanel({ asset }: { asset: InvestmentAsset }) {
  const auth = useAuth();
  const connected = useConnectedWallet(solanaClient);
  const connectedAddress = connected?.account.address;
  const authenticated = auth.status === "authenticated" && auth.sessionWalletAddress === connectedAddress;
  const transactionCapable = connected?.account.features.includes("solana:signTransaction") &&
    connected.supportedTransactionVersions.has(0);

  return (
    <aside className="surface investment-panel" aria-labelledby="investment-heading">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Invest</p>
      <h2 id="investment-heading" className="mt-2 text-xl font-semibold">Buy {asset.symbol}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">Invest USDC into this official PreStocks asset through Jupiter.</p>
      <div className="mt-6 border-t border-line pt-6">
        {!connected ? (
          <div>
            <p className="mb-4 text-sm text-muted">Connect a compatible Solana wallet to continue.</p>
            <WalletButton disconnectedLabel="Connect Wallet to Invest" />
          </div>
        ) : !authenticated ? (
          <div>
            <p className="mb-4 text-sm text-muted">Sign in to bind this investment to the connected wallet.</p>
            <button type="button" className="button w-full" disabled={auth.status === "authenticating"} onClick={() => void auth.signIn().catch(() => {})}>
              {auth.status === "authenticating" ? "Signing In…" : "Sign in to Invest"}
            </button>
            {auth.errorMessage && <p role="alert" className="investment-error">{auth.errorMessage}</p>}
          </div>
        ) : !transactionCapable ? (
          <p role="alert" className="investment-error mt-0">This wallet cannot sign the versioned Solana transaction required for this investment.</p>
        ) : (
          <AuthenticatedInvestmentForm
            account={connected.account}
            asset={asset}
            sessionWalletAddress={auth.sessionWalletAddress!}
          />
        )}
      </div>
      <p className="mt-6 border-t border-line pt-5 text-xs leading-5 text-muted">You will review the executable estimate before your wallet opens. StockPilot never signs or retries automatically.</p>
    </aside>
  );
}
