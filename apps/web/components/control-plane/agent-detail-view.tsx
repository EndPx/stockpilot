"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { AgentMark } from "./clients-view";
import { agentConnectionLabel } from "./agent-labels";
import { Activity, ClientRecord, Policy, controlFetch, formatDate } from "./shared";

const readScopes = [
  { value: "markets:read", label: "Markets", description: "Read Stocks and Pre-IPO market data" },
  { value: "portfolio:read", label: "Portfolio", description: "Read your Solana portfolio" },
  { value: "requests:read-own", label: "Own requests", description: "Read requests made by this agent" },
  { value: "approvals:read-own", label: "Own approvals", description: "Legacy read grant; no MCP tool" },
];
const readScopeValues = readScopes.filter((item) => item.value !== "approvals:read-own").map((item) => item.value);
const presets = [
  { label: "Read only", scopes: readScopeValues },
  { label: "Request only", scopes: ["investments:request"] },
  { label: "Read + request", scopes: [...readScopeValues, "investments:request"] },
];

function matches(current: string[], expected: string[]) {
  return current.length === expected.length && expected.every((scope) => current.includes(scope));
}

export function AccessSummary({ policy, active = true }: { policy: Policy; active?: boolean }) {
  const grantedScopes = new Set(policy.scopes);
  const reads = readScopes.filter((item) => grantedScopes.has(item.value));
  const canRequest = grantedScopes.has("investments:request") && policy.buyMode === "APPROVAL";
  return <div className="agent-access-body">
    {!active && <p className="agent-inactive-note" role="status">This client is inactive. Its saved permissions no longer grant access.</p>}
    <div className="agent-access-group"><span className="agent-detail-kicker">{active ? "Read" : "Saved read permissions"}</span>
      {reads.length ? reads.map((item) => <div className="agent-access-item" key={item.value}><span className="agent-access-dot" aria-hidden="true" /><div><strong>{item.label}</strong><span>{item.description}</span></div></div>)
        : <p className="control-note">No read access granted.</p>}
    </div>
    <div className="agent-access-group"><span className="agent-detail-kicker">{active ? "Investment requests" : "Saved request permission"}</span>
      {canRequest ? <><div className="agent-access-item"><span className="agent-access-dot agent-access-dot-request" aria-hidden="true" /><div><strong>Request a Pre-IPO BUY</strong><span>Requires your approval. Approval does not sign or execute a trade.</span></div></div>
        <dl className="agent-policy-limits"><div><dt>Per request</dt><dd>{policy.maxInvestmentUsd === null ? "No request cap" : `${policy.maxInvestmentUsd} USDC`}</dd></div><div><dt>24-hour requests</dt><dd>{policy.dailyRequestLimitUsd === null ? "No request cap" : `${policy.dailyRequestLimitUsd} USDC`}</dd></div></dl></>
        : <p className="control-note">Investment requests are off. Automatic BUY and SELL are unavailable.</p>}
    </div>
    <p className="agent-execution-boundary">This agent has no wallet-signing authority. StockPilot trading remains off.</p>
  </div>;
}

function AgentPolicyEditor({ policy, onSaved, onCancel, onReload }: {
  policy: Policy; onSaved: (policy: Policy) => void; onCancel: () => void; onReload: () => void;
}) {
  const [currentPolicy, setCurrentPolicy] = useState(policy);
  const [scopes, setScopes] = useState(policy.scopes);
  const [max, setMax] = useState(policy.maxInvestmentUsd ?? "10");
  const [daily, setDaily] = useState(policy.dailyRequestLimitUsd ?? "50");
  const [maxUnlimited, setMaxUnlimited] = useState(policy.maxInvestmentUsd === null);
  const [dailyUnlimited, setDailyUnlimited] = useState(policy.dailyRequestLimitUsd === null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [hasError, setHasError] = useState(false);
  const maxId = useId();
  const dailyId = useId();

  function toggleScope(scope: string, checked: boolean) {
    setScopes((current) => checked ? [...current, scope] : current.filter((item) => item !== scope));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const removingCap = (maxUnlimited && currentPolicy.maxInvestmentUsd !== null) ||
      (dailyUnlimited && currentPolicy.dailyRequestLimitUsd !== null);
    if (removingCap && !window.confirm("Remove this agent’s request cap? It can submit uncapped requests, but every investment still requires your approval and cannot execute a trade.")) return;
    setBusy(true); setFeedback(""); setHasError(false);
    try {
      const result = await controlFetch<{ policy: Policy }>(`/clients/${currentPolicy.clientId}/policy`, "PATCH", {
        scopes,
        buyMode: scopes.includes("investments:request") ? "APPROVAL" : "DISABLED",
        sellMode: "DISABLED",
        maxInvestmentUsd: maxUnlimited ? null : max,
        dailyRequestLimitUsd: dailyUnlimited ? null : daily,
        expectedVersion: currentPolicy.version,
      });
      setCurrentPolicy(result.policy);
      onSaved(result.policy);
      setFeedback("Policy saved. Existing requests retain their original permission snapshot.");
    } catch (cause) {
      setHasError(true);
      setFeedback(cause instanceof Error ? cause.message : "Policy update failed. Reload before trying again.");
    } finally { setBusy(false); }
  }

  return <form className="control-form agent-policy-editor" onSubmit={(event) => void save(event)}>
    <p className="control-note">Policy version {currentPolicy.version}. Changes affect future requests only.</p>
    <div className="control-filter" role="group" aria-label="Permission quick choices">{presets.map((preset) => <button key={preset.label} type="button" aria-pressed={matches(scopes, preset.scopes)} className={matches(scopes, preset.scopes) ? "control-filter-active" : ""} onClick={() => setScopes([...preset.scopes])}>{preset.label}</button>)}</div>
    <fieldset><legend>Read access</legend><div className="control-checks">{readScopes.map((item) => policy.scopes.includes(item.value) || item.value !== "approvals:read-own" ? <label key={item.value}><input type="checkbox" checked={scopes.includes(item.value)} onChange={(event) => toggleScope(item.value, event.target.checked)} />{item.value === "approvals:read-own" ? "Keep legacy approvals-read grant (no MCP tool)" : `Read ${item.label.toLowerCase()}`}</label> : null)}</div></fieldset>
    <fieldset><legend>Investment access</legend><div className="control-checks"><label><input type="checkbox" checked={scopes.includes("investments:request")} onChange={(event) => toggleScope("investments:request", event.target.checked)} />Request a Pre-IPO BUY for my approval</label></div><p className="control-note">Automatic BUY and SELL are unavailable. Approval does not sign or execute a transaction.</p></fieldset>
    <div className="control-form-pair">
      <div className="agent-limit-field"><label htmlFor={maxId}>Maximum per request · USDC</label><input id={maxId} type="number" inputMode="decimal" min="0.000001" step="0.000001" value={max} onChange={(event) => setMax(event.target.value)} disabled={maxUnlimited} required={!maxUnlimited} /><label className="agent-unlimited-option"><input type="checkbox" checked={maxUnlimited} onChange={(event) => setMaxUnlimited(event.target.checked)} />No per-request cap</label></div>
      <div className="agent-limit-field"><label htmlFor={dailyId}>24-hour request limit · USDC</label><input id={dailyId} type="number" inputMode="decimal" min="0.000001" step="0.000001" value={daily} onChange={(event) => setDaily(event.target.value)} disabled={dailyUnlimited} required={!dailyUnlimited} /><label className="agent-unlimited-option"><input type="checkbox" checked={dailyUnlimited} onChange={(event) => setDailyUnlimited(event.target.checked)} />No daily cap</label></div>
    </div>
    <p className="control-note">Limits apply to requests, not wallet execution. Removing a limit does not let this agent sign or spend funds.</p>
    <div className="agent-detail-actions"><button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="button" type="submit" disabled={busy || scopes.length === 0}>{busy ? "Saving…" : "Save policy"}</button></div>
    {feedback && <div role={hasError ? "alert" : "status"} className="control-feedback">{feedback}{hasError && <button className="text-link" type="button" onClick={onReload}>Reload current policy</button>}</div>}
  </form>;
}

function AgentIdentity({ client }: { client: ClientRecord }) {
  return <>
    <header className="agent-detail-header"><AgentMark name={client.name} /><div className="agent-detail-identity"><div className="agent-detail-title-row"><h1 className="page-title">{client.name}</h1><span className={`control-status ${client.status === "ACTIVE" ? "control-status-active" : ""}`}>{client.status.toLowerCase()}</span></div><p>{agentConnectionLabel(client)} · <code className="agent-client-id">{client.id}</code></p></div></header>
    <dl className="agent-detail-meta"><div><dt>Created</dt><dd>{formatDate(client.createdAt)}</dd></div><div><dt>Last used</dt><dd>{formatDate(client.lastUsedAt)}</dd></div><div><dt>Client expiry</dt><dd>{client.expiresAt ? formatDate(client.expiresAt) : "No client expiry set"}</dd></div>{client.oauthConnectedAt && <div><dt>OAuth connected</dt><dd>{formatDate(client.oauthConnectedAt)}</dd></div>}</dl>
  </>;
}

function AgentPolicyPanel({ client, policy, error, reload, onSaved }: {
  client: ClientRecord; policy: Policy | null; error: string; reload: () => void; onSaved: (policy: Policy) => void;
}) {
  const [editing, setEditing] = useState(false);
  const active = client.status === "ACTIVE";
  return <section className="surface control-panel">
    <div className="surface-header"><div><span className="agent-detail-kicker">Policy</span><h2>{active ? "Granted access" : "Last saved policy"}</h2></div>{active && !editing && policy && <button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit policy</button>}{editing && <span className="control-muted">Changes apply to future requests</span>}</div>
    {error ? <div className="control-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></div>
      : !policy ? <div className="control-state" role="status">Loading granted access…</div>
        : editing && active ? <AgentPolicyEditor policy={policy} onSaved={onSaved} onCancel={() => setEditing(false)} onReload={() => { setEditing(false); reload(); }} />
          : <AccessSummary policy={policy} active={active} />}
  </section>;
}

function AgentActivityPanel({ activity, error, reload }: {
  activity: Activity[] | null; error: string; reload: () => void;
}) {
  return <section className="surface control-panel"><div className="surface-header"><h2>Recent activity</h2><button className="secondary-button" type="button" onClick={reload}>Refresh</button></div>
    {error ? <div className="control-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></div>
      : !activity ? <div className="control-state" role="status">Loading this agent’s activity…</div>
        : activity.length === 0 ? <div className="control-state"><p>No recorded activity for this agent yet.</p></div>
          : <div className="control-list">{activity.map((event) => <article className="control-row" key={event.id}><div className="control-row-main"><strong>{event.eventType.replaceAll("_", " ").replaceAll(".", " ").toLowerCase()}</strong><span>{event.actorType.toLowerCase()}{event.assetSymbol ? ` · ${event.assetSymbol}` : ""}{event.amountUsd ? ` · ${event.amountUsd} USDC` : ""}</span></div><time className="control-muted" dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>{event.requestId && <Link className="secondary-button" href={`/approvals/${event.requestId}`}>View request</Link>}</article>)}</div>}
  </section>;
}

export function AgentDetailView({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [clientError, setClientError] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [revision, setRevision] = useState(0);
  const [activityRevision, setActivityRevision] = useState(0);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const reloadActivity = useCallback(() => setActivityRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setClient(null); setClientError(""); setPolicy(null); setPolicyError("");
    controlFetch<{ client: ClientRecord }>(`/clients/${encodeURIComponent(clientId)}`, "GET", undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setClient(result.client); })
      .catch((cause) => { if (!controller.signal.aborted) setClientError(cause instanceof Error ? cause.message : "Agent unavailable."); });
    controlFetch<{ policy: Policy }>(`/clients/${encodeURIComponent(clientId)}/policy`, "GET", undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPolicy(result.policy); })
      .catch((cause) => { if (!controller.signal.aborted) setPolicyError(cause instanceof Error ? cause.message : "Policy unavailable."); });
    return () => controller.abort();
  }, [clientId, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setActivity(null); setActivityError("");
    controlFetch<{ activity: Activity[] }>(`/activity?clientId=${encodeURIComponent(clientId)}`, "GET", undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setActivity(Array.isArray(result.activity) ? result.activity : []); })
      .catch((cause) => { if (!controller.signal.aborted) setActivityError(cause instanceof Error ? cause.message : "Activity unavailable."); });
    return () => controller.abort();
  }, [clientId, revision, activityRevision]);

  async function revoke() {
    if (!client || !window.confirm(`Revoke ${client.name} (${client.id})? Its OAuth access and any legacy credential will stop working.`)) return;
    setRevoking(true); setRevokeError("");
    try { await controlFetch(`/clients/${encodeURIComponent(client.id)}`, "DELETE"); reload(); }
    catch (cause) { setRevokeError(cause instanceof Error ? cause.message : "Revocation failed."); }
    finally { setRevoking(false); }
  }

  return <div className="dashboard-stack agent-detail-page">
    <Link className="text-link agent-back-link" href="/clients"><span aria-hidden="true">←</span> Back to Agents</Link>
    {clientError ? <section className="surface control-state" role="alert"><p>{clientError}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></section>
      : !client ? <section className="surface control-state" role="status">Loading agent details…</section>
      : <>
        <AgentIdentity client={client} />
        <AgentPolicyPanel client={client} policy={policy} error={policyError} reload={reload} onSaved={setPolicy} />
        <AgentActivityPanel activity={activity} error={activityError} reload={reloadActivity} />
        {client.status === "ACTIVE" && <div className="agent-revoke-region"><div><strong>Disconnect this agent</strong><p className="control-note">Revoking stops its OAuth access and any legacy key. This cannot be undone.</p></div><button className="secondary-button control-danger" type="button" disabled={revoking} onClick={() => void revoke()}>{revoking ? "Revoking…" : "Revoke access"}</button></div>}
        {revokeError && <p className="control-feedback" role="alert">{revokeError}</p>}
      </>}
  </div>;
}
