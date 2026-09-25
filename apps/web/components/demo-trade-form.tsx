"use client";

import { useEffect, useRef, useState } from "react";
import { decodeBase64Transaction, encodeBase64Transaction, InvestmentClientError, readInvestmentApiResponse } from "@/lib/investments/client";
import type { ActiveManualInvestmentStatusResponse, InvestmentExecutionResponse, ManualInvestmentStatusResponse } from "@/lib/investments/types";
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

function statusExecution(result: ManualInvestmentStatusResponse["execution"]): InvestmentExecutionResponse["execution"] {
  return { status: result.status === "CONFIRMED" || result.status === "FAILED" || result.status === "REJECTED"
    ? result.status : "PENDING", side: result.side ?? "BUY",
    providerRequestId: result.providerRequestId, transactionSignature: result.transactionSignature,
    actualInputAmountRaw: result.actualInputAmountRaw, actualOutputAmountRaw: result.actualOutputAmountRaw,
    solscanUrl: `https://solscan.io/tx/${encodeURIComponent(result.transactionSignature)}` };
}

export function DemoTradeForm({ asset, walletAddress, sign }: {
  asset: { symbol: string; name: string; mintAddress: string; provider: "prestocks" | "xstocks" };
  walletAddress: string;
  sign: (transaction: Uint8Array) => Promise<Uint8Array>;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("0.1");
  const [attested, setAttested] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [execution, setExecution] = useState<InvestmentExecutionResponse["execution"] | null>(null);
  const [busy, setBusy] = useState<"preparing" | "signing" | "submitting" | "checking" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const storageKey = `stockpilot:pending-trade:${walletAddress}`;

  function rememberPending(requestId: string | null) {
    setPendingRequestId(requestId);
    try {
      if (requestId) sessionStorage.setItem(storageKey, requestId);
      else sessionStorage.removeItem(storageKey);
    } catch { /* Recovery also queries the owner-bound server ledger. */ }
  }

  useEffect(() => {
    let cancelled = false;
    let storedId: string | null = null;
    try { storedId = sessionStorage.getItem(storageKey); } catch { /* optional storage */ }
    setPendingRequestId(storedId);
    setRecovering(true);
    setPrepared(null);
    setExecution(null);
    setUnknown(Boolean(storedId));
    setError(null);
    void fetch("/api/investments/manual/status", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify(storedId ? { providerRequestId: storedId } : { active: true }),
    }).then((response) => readInvestmentApiResponse<ActiveManualInvestmentStatusResponse>(response))
      .then((result) => {
        if (cancelled) return;
        if (result.execution) {
          const recovered = statusExecution(result.execution);
          setExecution(recovered);
          setUnknown(recovered.status === "PENDING");
          rememberPending(recovered.status === "PENDING" ? recovered.providerRequestId : null);
        } else setUnknown(false);
      }).catch(() => {
        if (!cancelled) {
          setUnknown(true);
          setError("Could not verify your previous trade status. Check status before starting another trade.");
        }
      }).finally(() => { if (!cancelled) setRecovering(false); });
    return () => { cancelled = true; };
  }, [storageKey]);

  const rawHolding = (raw: string, decimals: number) => {
    const padded = raw.padStart(decimals + 1, "0");
    const fraction = padded.slice(-decimals).replace(/0+$/, "");
    return decimals === 0 || !fraction ? padded.slice(0, -decimals || undefined) :
      `${padded.slice(0, -decimals)}.${fraction}`;
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/portfolio", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((body: { portfolio?: { positions?: { mintAddress: string; rawTokenAmount?: string; decimals?: number }[] } }) => {
        const position = body.portfolio?.positions?.find((item) => item.mintAddress === asset.mintAddress);
        if (!cancelled) setHeld(position?.rawTokenAmount && Number.isInteger(position.decimals)
          ? rawHolding(position.rawTokenAmount, position.decimals!) : "0");
      })
      .catch(() => { if (!cancelled) setHeld(null); });
    return () => { cancelled = true; };
  }, [asset.mintAddress, walletAddress, execution?.status, execution?.providerRequestId]);

  function selectSide(next: "BUY" | "SELL") {
    if (busy || recovering || unknown || execution?.status === "PENDING") return;
    setSide(next);
    setAmount(next === "BUY" ? "0.1" : "");
    setError(null);
    setPrepared(null);
    setExecution(null);
  }

  async function prepare() {
    if (!attested || !amount || busy || recovering || unknown || execution?.status === "PENDING") return;
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
        setError("Submission status is unknown. Do not sign or submit again. Check the trade status below.");
        dialogRef.current?.close();
      } else {
        setError(cause instanceof Error ? cause.message : "Wallet signing was cancelled or failed.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function checkStatus() {
    if (busy || recovering) return;
    setBusy("checking");
    try {
      const response = await fetch("/api/investments/manual/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(pendingRequestId || prepared?.review.requestId
          ? { providerRequestId: pendingRequestId ?? prepared!.review.requestId } : { active: true }),
      });
      const result = await readInvestmentApiResponse<ActiveManualInvestmentStatusResponse>(response);
      const updated = result.execution ? statusExecution(result.execution) : null;
      setExecution(updated);
      if (!updated || updated.status !== "PENDING") {
        setUnknown(false);
        rememberPending(null);
        setError(null);
      } else rememberPending(updated.providerRequestId);
    } catch {
      setError("Status is not verified yet. Do not resubmit; inspect your wallet and Solscan.");
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
        onClick={() => selectSide("BUY")}>Buy</button>
      <button type="button" className={side === "SELL" ? "button" : "secondary-button"}
        onClick={() => selectSide("SELL")}>Sell</button>
    </div>
    <label className="mt-5 block text-sm font-medium" htmlFor={`trade-amount-${asset.mintAddress}`}>
      {side === "BUY" ? "USDC to spend" : `${asset.symbol} to sell`}
    </label>
    <input id={`trade-amount-${asset.mintAddress}`} className="mt-2 w-full rounded-lg border border-line bg-transparent p-3"
      inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
      disabled={Boolean(busy || recovering || unknown || execution?.status === "PENDING")} />
    {side === "SELL" && <p className="mt-2 text-xs text-muted">Wallet holding: {held ?? "Checking…"} {asset.symbol}
      {held && held !== "0" && <button type="button" className="ml-2 underline" onClick={() => setAmount(held)}>Use holding</button>}</p>}
    <label className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted">
      <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
      <span>I confirm I am not a U.S. person, am not in a restricted jurisdiction, and have reviewed the issuer terms. This is my declaration, not StockPilot verification.</span>
    </label>
    {error && <p role="alert" className="investment-error">{error}</p>}
    {execution && <p role="status" className="mt-4 text-sm">{execution.status === "CONFIRMED" ? "Confirmed" :
      execution.status === "FAILED" ? "Failed on chain" : execution.status === "REJECTED"
      ? "Rejected before broadcast. Check your SOL balance and prepare a fresh quote." : "Pending verification"}
      {execution.status !== "REJECTED" && <> · <a href={execution.solscanUrl}
      target="_blank" rel="noopener noreferrer" className="text-link">View transaction ↗</a></>}</p>}
    {(unknown || execution?.status === "PENDING") && <button type="button" className="secondary-button mt-4"
      disabled={Boolean(busy) || recovering} onClick={() => void checkStatus()}>Check trade status</button>}
    <button type="button" className="button mt-5 w-full" disabled={!attested || !amount || Boolean(busy) || recovering || unknown || execution?.status === "PENDING"}
      onClick={() => void prepare()}>{recovering ? "Checking trade status…" : busy === "preparing" ? "Preparing quote…" : `Review ${side}`}</button>
    <p className="mt-4 text-xs leading-5 text-muted">No order is sent until you review and sign in Privy. A first BUY may create a token account and require extra SOL rent; 0.003 SOL may not cover both products. An unknown result is never retried automatically.</p>
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
