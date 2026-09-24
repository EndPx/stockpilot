"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Approval, controlFetch, formatDate, LoadState, PageHeader, useControlList } from "./shared";

const filters = ["ALL", "PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPIRED"] as const;

export function ApprovalsView() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("PENDING_APPROVAL");
  const { items, error, reload } = useControlList<Approval>(`/approvals?status=${filter}`, "approvals");
  return <div className="dashboard-stack">
    <PageHeader title="Approvals" description="Review agent investment requests. Approving records consent only; no transaction is signed or executed." />
    <div className="control-filter" role="group" aria-label="Approval status">{filters.map((status) => <button type="button" key={status} className={filter === status ? "control-filter-active" : ""} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === "PENDING_APPROVAL" ? "Pending" : status[0] + status.slice(1).toLowerCase()}</button>)}</div>
    <section className="surface control-panel"><div className="surface-header"><h2>{filter === "PENDING_APPROVAL" ? "Pending requests" : "Requests"}</h2><span className="control-muted">{items?.length ?? "—"} shown</span></div>
      <LoadState items={items} error={error} retry={reload} empty={filter === "PENDING_APPROVAL" ? "No requests are waiting for your approval." : "No requests match this status."} />
      {items && items.length > 0 && <div className="control-list">{items.map((item) => <article className="control-row" key={item.id}><div className="control-row-main"><strong>{item.assetName} <span className="control-muted">{item.assetSymbol}</span></strong><span>{item.clientName} · {formatDate(item.createdAt)} · expires {formatDate(item.expiresAt)}</span></div><strong className="control-amount">${item.amountUsd} USDC</strong><span className={`control-status ${item.status === "PENDING_APPROVAL" ? "control-status-pending" : ""}`}>{item.status.replaceAll("_", " ").toLowerCase()}</span><Link href={`/approvals/${item.id}`} className="secondary-button">Review</Link></article>)}</div>}
    </section>
  </div>;
}

export function ApprovalDetailView() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Approval | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    controlFetch<{ approval: Approval }>(`/approvals/${id}`, "GET", undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setItem(result.approval); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Request unavailable."); });
    return () => controller.abort();
  }, [id]);

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!item || !window.confirm(`${decision === "APPROVED" ? "Approve" : "Reject"} this ${item.amountUsd} USDC request from ${item.clientName}? Approval does not execute a trade.`)) return;
    setBusy(true); setFeedback("");
    try {
      const result = await controlFetch<{ approval: Approval; executionAvailable: boolean }>(`/approvals/${id}`, "POST", { decision });
      setItem(result.approval);
      setFeedback(result.approval.status === "APPROVED" ? "Approval recorded. Trading remains disabled; no funds moved." : "Request rejected. No funds moved.");
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Decision failed. Refresh the request status."); }
    finally { setBusy(false); }
  }

  return <div className="dashboard-stack"><PageHeader title="Review request" description="Verify the asset, client, amount, and policy snapshot before deciding." action={<Link href="/approvals" className="secondary-button">Back to approvals</Link>} />
    {error ? <section className="surface control-state" role="alert">{error}</section> : !item ? <section className="surface control-state" role="status">Loading request…</section> : <section className="surface control-panel"><div className="surface-header"><h2>{item.assetName} · {item.assetSymbol}</h2><span className={`control-status ${item.status === "PENDING_APPROVAL" ? "control-status-pending" : ""}`}>{item.status.replaceAll("_", " ").toLowerCase()}</span></div>
      <dl className="control-facts"><div><dt>Client</dt><dd>{item.clientName}</dd></div><div><dt>Requested amount</dt><dd>${item.amountUsd} USDC</dd></div><div><dt>Provider / market</dt><dd>PreStocks · Pre-IPO</dd></div><div><dt>Canonical mint</dt><dd className="control-address">{item.canonicalMint}</dd></div><div><dt>Policy snapshot</dt><dd>Version {item.policyVersion} · {item.policyMaxInvestmentUsd === null ? "No per-request cap" : `max $${item.policyMaxInvestmentUsd} USDC`}</dd></div><div><dt>Submitted</dt><dd>{formatDate(item.createdAt)}</dd></div><div><dt>Expires</dt><dd>{formatDate(item.expiresAt)}</dd></div>{item.decidedAt && <div><dt>Decided</dt><dd>{formatDate(item.decidedAt)}</dd></div>}</dl>
      <div className="control-decision"><p>Approval is a record of your decision only. It does not prepare, sign, or execute a wallet transaction.</p>{item.status === "PENDING_APPROVAL" && <div className="control-row-actions"><button type="button" className="button" disabled={busy} onClick={() => void decide("APPROVED")}>{busy ? "Saving…" : "Approve request"}</button><button type="button" className="secondary-button control-danger" disabled={busy} onClick={() => void decide("REJECTED")}>Reject</button></div>}</div>
    </section>}{feedback && <p className="control-feedback" role="status">{feedback}</p>}
  </div>;
}
