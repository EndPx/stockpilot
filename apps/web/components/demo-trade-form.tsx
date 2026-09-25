"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeBase64Transaction, encodeBase64Transaction, InvestmentClientError, readInvestmentApiResponse } from "@/lib/investments/client";
import type { InvestmentExecutionResponse } from "@/lib/investments/types";
import { pollTradeStatus, readSellHolding, readTradeStatus, tradeStatusLabel, type SellHolding, type TradeExecution } from "@/lib/investments/trade-state";
import { InvestmentEligibilityNotice } from "./investment-panel";

type Review = {
  requestId: string; side: "BUY" | "SELL"; provider: "prestocks" | "xstocks";
  symbol: string; name: string; walletAddress: string; inputMint: string; outputMint: string;
  inputAmountRaw: string; inputAmount: string; estimatedOutputAmount: string;
  minimumOutputAmount: string; requiredMinimumOutputRaw: string;
  maximumWalletNativeDebitLamportsRaw: string; priceImpactPct: string;
  router: string; expiresAt: string;
};
type Prepared = { review: Review; transaction: string; investmentToken: string };

export function DemoTradeForm({ asset, walletAddress, sign }: {
  asset: { symbol: string; name: string; mintAddress: string; provider: "prestocks" | "xstocks" };
  walletAddress: string;
  sign: (transaction: Uint8Array) => Promise<Uint8Array>;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("0.1");
  const [attested, setAttested] = useState(false);
  const [held, setHeld] = useState<SellHolding | null>(null);
  const [holdingState, setHoldingState] = useState<"loading" | "ready" | "error">("loading");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [execution, setExecution] = useState<TradeExecution | null>(null);
  const [busy, setBusy] = useState<"preparing" | "signing" | "submitting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const storageKey = `stockpilot:pending-trade:${walletAddress}`;

  const rememberPending = useCallback((requestId: string | null) => {
    setPendingRequestId(requestId);
    try {
      if (requestId) sessionStorage.setItem(storageKey, requestId);
      else sessionStorage.removeItem(storageKey);
    } catch { /* Recovery also queries the owner-bound server ledger. */ }
  }, [storageKey]);

  const receiveStatus = useCallback((updated: TradeExecution | null) => {
    const unresolved = updated?.status === "PENDING" || updated?.status === "REVIEW_REQUIRED";
    setExecution(updated);
    setUnknown(unresolved);
    rememberPending(unresolved ? updated.providerRequestId : null);
    setError(null);
  }, [rememberPending]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 20_000);
    let storedId: string | null = null;
    try { storedId = sessionStorage.getItem(storageKey); } catch { /* optional storage */ }
    setPendingRequestId(storedId);
    setRecovering(true);
    setPrepared(null);
    setExecution(null);
    setUnknown(Boolean(storedId));
    setError(null);
    void readTradeStatus(storedId, controller.signal).then((result) => {
        if (cancelled) return;
        receiveStatus(result);
      }).catch(() => {
        if (!cancelled) {
          setUnknown(true);
          setError("Trade status is temporarily unavailable. Checking automatically…");
        }
      }).finally(() => { clearTimeout(deadline); if (!cancelled) setRecovering(false); });
    return () => { cancelled = true; clearTimeout(deadline); controller.abort(); };
  }, [storageKey, receiveStatus]);

  const unresolved = unknown || execution?.status === "PENDING" || execution?.status === "REVIEW_REQUIRED";
  const shouldPoll = unresolved && execution?.status !== "REVIEW_REQUIRED";
  useEffect(() => {
    if (busy || recovering || !shouldPoll) return;
    return pollTradeStatus({
      requestId: pendingRequestId,
      onResult: receiveStatus,
      onError: () => setError("Confirmation is taking longer. Checking automatically; do not submit again."),
    });
  }, [busy, recovering, shouldPoll, pendingRequestId, receiveStatus]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let controller: AbortController;
    let deadline: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      deadline = setTimeout(() => controller.abort(), 20_000);
      setHoldingState("loading");
      try {
        const response = await fetch("/api/portfolio", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const holding = await readSellHolding(response, walletAddress, asset.mintAddress);
        if (!cancelled) { setHeld(holding); setHoldingState("ready"); }
      } catch {
        if (!cancelled) { setHeld(null); setHoldingState("error"); }
      } finally { clearTimeout(deadline); inFlight = false; }
    };
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    const interval = side === "SELL" ? setInterval(refreshVisible, 30_000) : undefined;
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(deadline);
      clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [asset.mintAddress, walletAddress, side, execution?.status, execution?.providerRequestId]);

  function selectSide(next: "BUY" | "SELL") {
    if (busy || recovering || unresolved) return;
    setSide(next);
    setAmount(next === "BUY" ? "0.1" : "");
    setError(null);
    setPrepared(null);
    setExecution(null);
  }

  async function prepare() {
    if (!attested || !amount || busy || recovering || unresolved || (side === "SELL" && holdingState !== "ready")) return;
    setBusy("preparing");
    setError(null);
    setExecution(null);
    try {
      const response = await fetch("/api/investments/demo/prepare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ side, provider: asset.provider, mintAddress: asset.mintAddress,
          amount, eligibleNonUsAttestation: true }),
      });
      const result = await readInvestmentApiResponse<Prepared>(response);
      if (result.review.walletAddress !== walletAddress || result.review.side !== side ||
          result.review.outputMint !== (side === "BUY" ? asset.mintAddress : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")) {
        throw new Error("The prepared trade does not match your wallet or asset.");
      }
      setPrepared(result);
      dialogRef.current?.showModal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare this trade.");
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!prepared || busy || Date.parse(prepared.review.expiresAt) <= Date.now()) {
      setError("The quote expired. Prepare a fresh review.");
      return;
    }
    setError(null);
    setBusy("signing");
    let signed = false;
    try {
      // Release the native top layer so Privy's signing portal can receive input.
      dialogRef.current?.close();
      const bytes = await sign(decodeBase64Transaction(prepared.transaction));
      signed = true;
      setBusy("submitting");
      rememberPending(prepared.review.requestId);
      const response = await fetch("/api/investments/demo/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ signedTransaction: encodeBase64Transaction(bytes),
          investmentToken: prepared.investmentToken }),
      });
      const result = await readInvestmentApiResponse<InvestmentExecutionResponse>(response);
      setExecution(result.execution);
      if (result.execution.status !== "PENDING") rememberPending(null);
      dialogRef.current?.close();
    } catch (cause) {
      if (signed && cause instanceof InvestmentClientError && cause.submissionStatus === "NOT_SUBMITTED") {
        rememberPending(null);
        setPrepared(null);
        setError(`${cause.message} No transaction was submitted. Prepare a fresh review.`);
        dialogRef.current?.close();
      } else if (signed) {
        setUnknown(true);
        setError("Confirming your submission automatically. Do not sign or submit again.");
        dialogRef.current?.close();
      } else {
        setError(cause instanceof Error ? cause.message : "Wallet signing was cancelled or failed.");
      }
    } finally {
      setBusy(null);
    }
  }

  return <aside className="surface investment-panel" aria-label={`Trade ${asset.symbol}`}>
    <p className="eyebrow">Manual trade · Solana</p>
    <h2 className="mt-2 text-xl font-semibold">Trade {asset.symbol}</h2>
    <p className="mt-2 text-sm text-muted">Choose your amount, review the quote, and sign with your wallet.</p>
    <InvestmentEligibilityNotice market={asset.provider === "prestocks" ? "pre-ipo" : "stocks"} />
    <div className="mt-5 grid grid-cols-2 gap-2">
      <button type="button" className={side === "BUY" ? "button" : "secondary-button"}
        disabled={Boolean(busy || recovering || unresolved)} aria-pressed={side === "BUY"} onClick={() => selectSide("BUY")}>Buy</button>
      <button type="button" className={side === "SELL" ? "button" : "secondary-button"}
        disabled={Boolean(busy || recovering || unresolved)} aria-pressed={side === "SELL"} onClick={() => selectSide("SELL")}>Sell</button>
    </div>
    <label className="mt-5 block text-sm font-medium" htmlFor={`trade-amount-${asset.mintAddress}`}>
      {side === "BUY" ? "USDC to spend" : `${asset.symbol} to sell`}
    </label>
    <input id={`trade-amount-${asset.mintAddress}`} className="mt-2 w-full rounded-lg border border-line bg-transparent p-3"
      inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
      disabled={Boolean(busy || recovering || unresolved)} />
    {side === "SELL" && <div className="mt-2 text-xs text-muted">
      <p role="status">{holdingState === "loading" ? "Checking wallet balance…" : holdingState === "error"
        ? "Balance unavailable. Refreshing automatically…" : `Wallet holding: ${held?.displayAmount ?? "Display quantity unavailable"}${held?.displayAmount ? ` ${asset.symbol}` : ""}`}</p>
      {holdingState === "ready" && held?.scaled && <p className="mt-2">Available to sell: {held.amount} base tokens. Wallet display uses the issuer multiplier.</p>}
      {holdingState === "ready" && held && held.amount !== "0" && <button type="button" className="secondary-button mt-2"
        disabled={Boolean(busy || recovering || unresolved)} onClick={() => setAmount(held.amount)}>Use holding</button>}
    </div>}
    <label className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted">
      <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
      <span>I confirm I am not a U.S. person, am not in a restricted jurisdiction, and have reviewed the issuer terms. This is my declaration, not StockPilot verification.</span>
    </label>
    {error && <p role="alert" className="investment-error">{error}</p>}
    {execution && <p role="status" className="mt-4 text-sm">{tradeStatusLabel(execution.status)}
      {execution.status !== "REJECTED" && <> · <a href={execution.solscanUrl}
      target="_blank" rel="noopener noreferrer" className="text-link">View transaction ↗</a></>}</p>}
    <button type="button" className="button mt-5 w-full" disabled={!attested || !amount || Boolean(busy) || recovering || unresolved || (side === "SELL" && (holdingState !== "ready" || held?.amount === "0"))}
      onClick={() => void prepare()}>{recovering ? "Checking trade status…" : busy === "preparing" ? "Preparing quote…" :
        busy === "signing" ? "Waiting for wallet approval…" : busy === "submitting" ? "Submitting trade…" : `Review ${side}`}</button>
    <dialog ref={dialogRef} className="wallet-dialog" aria-label="Review trade" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      {prepared && <div className="p-6">
        <p className="wallet-dialog-kicker">Review {prepared.review.side}</p>
        <h2 className="wallet-dialog-title">{prepared.review.name}</h2>
        <dl className="investment-review-list mt-6">
          <div><dt>You send</dt><dd>{prepared.review.inputAmount} {side === "BUY" ? "USDC" : asset.symbol}</dd></div>
          <div><dt>{side === "BUY" && asset.provider === "prestocks" ? "Quote before token transfer fee" : "Estimated receive"}</dt><dd>{prepared.review.estimatedOutputAmount} {side === "BUY" ? asset.symbol : "USDC"}</dd></div>
          <div><dt>Minimum receive</dt><dd>{prepared.review.minimumOutputAmount} {side === "BUY" ? asset.symbol : "USDC"}</dd></div>
          <div><dt>Route</dt><dd>{prepared.review.router}</dd></div>
          <div><dt>Price impact</dt><dd>{prepared.review.priceImpactPct}%</dd></div>
          <div><dt>Maximum authorized SOL debit</dt><dd>{Number(prepared.review.maximumWalletNativeDebitLamportsRaw) / 1e9} SOL</dd></div>
          <div><dt>Quote expires</dt><dd>{new Date(prepared.review.expiresAt).toLocaleTimeString()}</dd></div>
        </dl>
        <p className="mt-4 text-xs leading-5 text-muted">The token may have issuer controls and transfer fees. Tokenized exposure is not direct share ownership. Your Privy wallet must approve this exact transaction.</p>
        {error && <p role="alert" className="investment-error">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="button" className="button" disabled={Boolean(busy)} onClick={() => void submit()}>{busy ? "Working…" : "Sign and submit"}</button>
        </div>
      </div>}
    </dialog>
  </aside>;
}
