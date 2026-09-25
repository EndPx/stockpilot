"use client";

import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useSignTransaction } from "@solana/react";
import type { Portfolio } from "@stockpilot/core/portfolio";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  classifyInvestmentApprovalError,
  InvestmentClientError,
  readInvestmentApiResponse,
  runInvestmentApproval,
} from "@/lib/investments/client";
import type { ActiveManualInvestmentStatusResponse, InvestmentExecutionResponse, ManualInvestmentStatusResponse, PreparedInvestmentResponse } from "@/lib/investments/types";
import { SOLANA_CHAIN } from "@/lib/solana/config";
import { useAuth } from "@/providers/auth-provider";
import { solanaClient, type StockPilotSolanaClient } from "@/providers/solana-provider";
import { WalletButton } from "./wallet/wallet-button";

type ConnectedAccount = NonNullable<ReturnType<StockPilotSolanaClient["wallet"]["getState"]>["connected"]>["account"];
type InvestmentAsset = { symbol: string; name: string };
type Workflow = "idle" | "preparing" | "review" | "signing" | "submitting" | "confirming" | "pending" | "review-required" | "success" | "failed-on-chain" | "failure";

function formatLamportsAsSol(raw: string): string {
  const lamports = BigInt(raw);
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
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

async function fetchActiveManualStatus(signal?: AbortSignal): Promise<ActiveManualInvestmentStatusResponse["execution"]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 15_000);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch("/api/investments/manual/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ active: true }),
      signal: controller.signal,
    });
    const result = await readInvestmentApiResponse<ActiveManualInvestmentStatusResponse>(response);
    if (!result || typeof result !== "object" || !Object.hasOwn(result, "execution") ||
      (result.execution !== null && (typeof result.execution !== "object" ||
        !result.execution || typeof result.execution.providerRequestId !== "string" ||
        typeof result.execution.transactionSignature !== "string"))) {
      throw new InvestmentClientError("PROVIDER_UNAVAILABLE", "StockPilot could not verify earlier trades.");
    }
    return result.execution;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
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

export function InvestmentEligibilityNotice({ market }: { market: "stocks" | "pre-ipo" }) {
  return <div className="investment-disclosure" role="note">
    <strong>Not for U.S. persons</strong>
    <p>{market === "stocks"
      ? "Tokenized stocks are issued for eligible non-U.S. investors only and carry risk of total loss."
      : "Pre-IPO tokens are not available to U.S. persons or other ineligible investors and carry risk of total loss."}</p>
  </div>;
}

export function InvestmentForm({
  connectedWalletAddress,
  asset,
  sessionWalletAddress,
  sign,
}: {
  connectedWalletAddress: string;
  asset: InvestmentAsset;
  sessionWalletAddress: string;
  sign: (transaction: Uint8Array) => Promise<Uint8Array>;
}) {
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
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [recoveryState, setRecoveryState] = useState<"checking" | "ready" | "error">("checking");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const statusCheckInFlightRef = useRef(false);
  const busy = ["preparing", "signing", "submitting", "confirming"].includes(workflow);
  const unresolved = workflow === "pending" || workflow === "review-required";
  const providerRequestId = execution?.execution.providerRequestId ?? prepared?.investment.providerRequestId;

  const loadPortfolio = useCallback(async (signal?: AbortSignal) => {
    const result = await fetchPortfolio(signal);
    setPortfolio(result);
    setPortfolioError(undefined);
  }, []);

  const applyManualStatus = useCallback((status: ManualInvestmentStatusResponse["execution"]) => {
    setPrepared(undefined);
    setExecution({ execution: {
      status: status.status === "CONFIRMED" ? "CONFIRMED" : status.status === "FAILED" ? "FAILED" : "PENDING",
      side: status.side ?? "BUY",
      providerRequestId: status.providerRequestId,
      transactionSignature: status.transactionSignature,
      actualInputAmountRaw: status.actualInputAmountRaw,
      actualOutputAmountRaw: status.actualOutputAmountRaw,
      solscanUrl: `https://solscan.io/tx/${encodeURIComponent(status.transactionSignature)}`,
    } });
    if (status.status === "CONFIRMED") {
      setError(undefined);
      setWorkflow("success");
      void loadPortfolio().catch((cause: unknown) => setPortfolioError(errorCopy(cause).message));
    } else if (status.status === "FAILED") {
      setError(undefined);
      setWorkflow("failed-on-chain");
    } else if (status.status === "REVIEW_REQUIRED") {
      setError({ code: "REVIEW_REQUIRED", message: "StockPilot cannot verify this transaction's final effect. Do not resubmit; inspect the transaction before taking another action." });
      setWorkflow("review-required");
    } else {
      setError(undefined);
      setWorkflow("pending");
    }
  }, [loadPortfolio]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPortfolio(controller.signal).catch((loadError: unknown) => {
      if (!controller.signal.aborted) setPortfolioError(errorCopy(loadError).message);
    });
    return () => controller.abort();
  }, [loadPortfolio, sessionWalletAddress]);

  useEffect(() => {
    const controller = new AbortController();
    setRecoveryState("checking");
    void fetchActiveManualStatus(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        if (status) applyManualStatus(status);
        setRecoveryState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setRecoveryState("error");
      });
    return () => controller.abort();
  }, [applyManualStatus, recoveryAttempt, sessionWalletAddress]);

  useEffect(() => {
    if (prepared && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [prepared]);

  function closeDialog() {
    if (!busy) dialogRef.current?.close();
  }

  async function prepare() {
    if (unresolved || busy || recoveryState !== "ready") return;
    setWorkflow("preparing");
    setError(undefined);
    setExecution(undefined);
    if (!dialogRef.current?.open) setPrepared(undefined);
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
      if (prepareError instanceof InvestmentClientError && prepareError.code === "UNRESOLVED_TRADE") {
        setRecoveryState("checking");
        try {
          const active = await fetchActiveManualStatus();
          if (active) {
            applyManualStatus(active);
          } else {
            setError({ code: "UNRESOLVED_TRADE", message: "The earlier trade has changed status. Prepare a new review after checking your wallet." });
            setWorkflow("failure");
          }
          setRecoveryState("ready");
        } catch {
          setRecoveryState("error");
          setPrepared(undefined);
          setWorkflow("idle");
          dialogRef.current?.close();
        }
        return;
      }
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
    let signed = false;
    try {
      const result = await runInvestmentApproval({
        prepared,
        connectedWalletAddress,
        sessionWalletAddress,
        sign,
        execute: executeSigned,
        refreshPortfolio: () => loadPortfolio(),
        onPortfolioRefreshError: (cause) => setPortfolioError(errorCopy(cause).message),
        onSigned: () => { signed = true; },
      });
      setExecution(result);
      setWorkflow(result.execution.status === "CONFIRMED" ? "success"
        : result.execution.status === "FAILED" ? "failed-on-chain" : "pending");
    } catch (approvalError) {
      const kind = classifyInvestmentApprovalError(approvalError, signed);
      if (kind === "status-unknown") {
        setError({ code: "EXECUTION_STATUS_UNKNOWN", message: "The signed transaction's status is unknown. Check its status before any new attempt; StockPilot will not submit it again automatically." });
        setWorkflow("review-required");
      } else if (kind === "wallet-rejected") {
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

  const checkStatus = useCallback(async () => {
    if (!providerRequestId || statusCheckInFlightRef.current) return;
    statusCheckInFlightRef.current = true;
    setCheckingStatus(true);
    try {
      const response = await fetch("/api/investments/manual/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ providerRequestId }),
      });
      const result = await readInvestmentApiResponse<ManualInvestmentStatusResponse>(response);
      applyManualStatus(result.execution);
    } catch {
      setError({ code: "EXECUTION_STATUS_UNKNOWN", message: "The transaction status could not be verified. Do not submit again; check the wallet and explorer before taking another action." });
      setWorkflow("review-required");
    } finally {
      statusCheckInFlightRef.current = false;
      setCheckingStatus(false);
    }
  }, [providerRequestId, applyManualStatus]);

  useEffect(() => {
    if (workflow !== "pending") return;
    const interval = window.setInterval(() => { void checkStatus(); }, 4_000);
    const stop = window.setTimeout(() => window.clearInterval(interval), 60_000);
    return () => { window.clearInterval(interval); window.clearTimeout(stop); };
  }, [workflow, checkStatus]);

  const expired = prepared ? Date.parse(prepared.investment.expiresAt) <= Date.now() : false;

  return (
    <>
      {recoveryState === "checking" && <p role="status" className="investment-status">Checking for an earlier trade before another order can be prepared…</p>}
      {recoveryState === "error" && <div role="alert" className="investment-error">StockPilot could not verify whether an earlier trade is unresolved. New orders are paused until this check succeeds. <button type="button" className="secondary-button mt-3" onClick={() => setRecoveryAttempt((attempt) => attempt + 1)}>Retry status check</button></div>}
      {(workflow === "success" || workflow === "failed-on-chain") && execution &&
        <p role="status" className="investment-status">An earlier trade was {workflow === "success" ? "confirmed" : "finalized as failed"} on Solana. <a href={execution.execution.solscanUrl} target="_blank" rel="noopener noreferrer">View transaction<span className="sr-only"> (opens in a new tab)</span></a>.</p>}
      {unresolved && <p role="status" className={workflow === "review-required" ? "investment-error" : "investment-status"}>This order has an unresolved transaction status. Do not sign or submit it again.</p>}
      <form onSubmit={(event) => { event.preventDefault(); if (unresolved) { dialogRef.current?.showModal(); void checkStatus(); } else void prepare(); }}>
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
            disabled={busy || unresolved || recoveryState !== "ready"}
            onChange={(event) => setAmount(event.target.value)}
          />
          <button
            type="button"
            className="investment-max"
            disabled={!portfolio || busy || unresolved || recoveryState !== "ready"}
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
          disabled={busy || checkingStatus || recoveryState !== "ready" || (!unresolved && (!portfolio || !amount || Boolean(portfolioError)))}
        >
          {unresolved ? "View transaction status" : <PreparingLabel workflow={workflow} />}
        </button>
      </form>

      <dialog
        ref={dialogRef}
        className="investment-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => { if (busy) event.preventDefault(); }}
        onClose={() => {
          if (workflow !== "pending" && workflow !== "review-required") {
            setPrepared(undefined);
            setExecution(undefined);
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
              <p className="mt-3 text-sm leading-6 text-muted">StockPilot verified the finalized transaction on Solana. Portfolio balances are read separately and may take time to update.</p>
              {portfolioError && <p role="alert" className="investment-error">Portfolio refresh unavailable: {portfolioError}</p>}
              <dl className="investment-review-list mt-6">
                <div><dt>Transaction</dt><dd className="break-all font-mono text-xs">{execution.execution.transactionSignature}</dd></div>
              </dl>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <a className="secondary-button" href={execution.execution.solscanUrl} target="_blank" rel="noopener noreferrer">View on Solscan<span className="sr-only"> (opens in a new tab)</span></a>
                <Link className="button" href="/app">View Portfolio</Link>
              </div>
            </>
          ) : workflow === "pending" || workflow === "review-required" || workflow === "failed-on-chain" ? (
            <>
              <p className="wallet-dialog-kicker">Transaction status</p>
              <h2 id={titleId} className="wallet-dialog-title">{workflow === "failed-on-chain" ? "Transaction failed" : workflow === "review-required" ? "Review required" : "Awaiting Solana confirmation"}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{workflow === "failed-on-chain"
                ? "The transaction is finalized as failed on Solana. No purchase has been recorded."
                : workflow === "review-required"
                  ? "StockPilot cannot verify the final result. Check your wallet and the transaction before any new attempt; no automatic retry will occur."
                  : "The signed order may have reached the provider, but its final result is not verified yet. Do not submit the order again."}</p>
              {error && <p role="alert" className="investment-error">{error.message}</p>}
              {execution?.execution.transactionSignature && <dl className="investment-review-list mt-6"><div><dt>Transaction</dt><dd className="break-all font-mono text-xs">{execution.execution.transactionSignature}</dd></div></dl>}
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {execution?.execution.solscanUrl && <a className="secondary-button" href={execution.execution.solscanUrl} target="_blank" rel="noopener noreferrer">View on Solscan<span className="sr-only"> (opens in a new tab)</span></a>}
                {workflow !== "failed-on-chain" && <button type="button" className="button" disabled={checkingStatus} onClick={() => void checkStatus()}>{checkingStatus ? "Checking…" : "Check status"}</button>}
                <button type="button" className="secondary-button" onClick={closeDialog}>Close</button>
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
                <div><dt>Minimum received</dt><dd>{prepared.investment.minimumOutputAmount} {prepared.investment.asset.symbol}</dd></div>
                <div><dt>Maximum SOL debit</dt><dd>{formatLamportsAsSol(prepared.investment.maximumWalletNativeDebitLamportsRaw)} SOL</dd></div>
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

function LegacyAuthenticatedInvestmentForm({
  account,
  asset,
  sessionWalletAddress,
}: {
  account: ConnectedAccount;
  asset: InvestmentAsset;
  sessionWalletAddress: string;
}) {
  const signTransaction = useSignTransaction(account, SOLANA_CHAIN);
  return <InvestmentForm
    key={sessionWalletAddress}
    connectedWalletAddress={account.address}
    asset={asset}
    sessionWalletAddress={sessionWalletAddress}
    sign={async (transaction) => (await signTransaction({ transaction })).signedTransaction}
  />;
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
      <InvestmentEligibilityNotice market="pre-ipo" />
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
          <LegacyAuthenticatedInvestmentForm
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
