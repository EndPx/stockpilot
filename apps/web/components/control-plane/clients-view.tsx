"use client";

import Link from "next/link";
import { useState } from "react";
import { ClientRecord, Policy, controlFetch, formatDate, LoadState, PageHeader, useControlList } from "./shared";

const clientTypes = ["CLAUDE_CODE", "CODEX", "CURSOR", "CUSTOM"] as const;
const scopeOptions = [
  { value: "markets:read", label: "Read markets" },
  { value: "portfolio:read", label: "Read portfolio" },
  { value: "investments:request", label: "Request investments" },
  { value: "requests:read-own", label: "Read own requests" },
  { value: "approvals:read-own", label: "Read own approvals" },
];

export function ClientsView() {
  const { items, error, reload } = useControlList<ClientRecord>("/clients", "clients");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof clientTypes)[number]>("CLAUDE_CODE");
  const [scopes, setScopes] = useState<string[]>(["markets:read"]);
  const [max, setMax] = useState("10");
  const [daily, setDaily] = useState("50");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyMax, setPolicyMax] = useState("");
  const [policyDaily, setPolicyDaily] = useState("");
  const [policyScopes, setPolicyScopes] = useState<string[]>([]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback("");
    try {
      await controlFetch("/clients", "POST", { name, clientType: type, scopes, maxInvestmentUsd: max, dailyRequestLimitUsd: daily });
      setName(""); setFeedback("Client created. Issue its one-time credential from Credentials."); reload();
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Client creation failed."); }
    finally { setBusy(false); }
  }

  async function openPolicy(id: string) {
    setSelected(id); setPolicy(null); setFeedback("");
    try {
      const result = await controlFetch<{ policy: Policy }>(`/clients/${id}/policy`);
      setPolicy(result.policy); setPolicyMax(result.policy.maxInvestmentUsd);
      setPolicyDaily(result.policy.dailyRequestLimitUsd); setPolicyScopes(result.policy.scopes);
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Policy unavailable."); }
  }

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!policy) return; setBusy(true); setFeedback("");
    try {
      const result = await controlFetch<{ policy: Policy }>(`/clients/${policy.clientId}/policy`, "PATCH", {
        scopes: policyScopes, maxInvestmentUsd: policyMax, dailyRequestLimitUsd: policyDaily, expectedVersion: policy.version,
      });
      setPolicy(result.policy); setFeedback("Policy updated. Existing requests retain their original policy snapshot."); reload();
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Policy update failed."); }
    finally { setBusy(false); }
  }

  async function revoke(client: ClientRecord) {
    if (!window.confirm(`Revoke ${client.name}? Its credential will stop working immediately.`)) return;
    setBusy(true); setFeedback("");
    try { await controlFetch(`/clients/${client.id}`, "DELETE"); setSelected(null); setPolicy(null); setFeedback(`${client.name} revoked.`); reload(); }
    catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Revocation failed."); }
    finally { setBusy(false); }
  }

  function choosePreset(preset: (typeof clientTypes)[number]) {
    setType(preset);
    if (!name) setName(preset === "CLAUDE_CODE" ? "Claude Code" : preset === "CODEX" ? "Codex" : "Cursor");
    document.getElementById("client-name")?.focus();
  }

  return <div className="dashboard-stack">
    <PageHeader title="Agents" description="Create a bounded MCP client for your AI tool. Clients can read or request within their policy, but cannot execute trades." action={<Link className="secondary-button" href="/credentials">Credentials</Link>} />
    <section className="surface control-panel"><div className="surface-header"><h2>Connect an agent</h2><span className="control-muted">Choose a client to configure</span></div>
      <div className="agent-presets">
        <button type="button" onClick={() => choosePreset("CLAUDE_CODE")}>Claude Code</button>
        <button type="button" onClick={() => choosePreset("CODEX")}>Codex</button>
        <button type="button" onClick={() => choosePreset("CURSOR")}>Cursor</button>
      </div>
    </section>
    <section className="surface control-panel"><div className="surface-header"><h2>Your clients</h2><span className="control-muted">{items?.length ?? "—"} clients</span></div>
      <LoadState items={items} error={error} retry={reload} empty="No agent clients yet. Configure one below." />
      {items && items.length > 0 && <div className="control-list">{items.map((client) => <article className="control-row" key={client.id}>
        <div className="control-row-main"><strong>{client.name}</strong><span>{client.clientType.replaceAll("_", " ")} · {client.scopes.length} permissions · Last used {formatDate(client.lastUsedAt)}</span></div>
        <span className={`control-status ${client.status === "ACTIVE" ? "control-status-active" : ""}`}>{client.status.toLowerCase()}</span>
        <div className="control-row-actions"><button type="button" className="secondary-button" onClick={() => void openPolicy(client.id)}>Policy</button>{client.status === "ACTIVE" && <button type="button" className="secondary-button control-danger" disabled={busy} onClick={() => void revoke(client)}>Revoke</button>}</div>
      </article>)}</div>}
    </section>
    <section className="surface control-panel"><div className="surface-header"><h2>New client</h2></div>
      <form className="control-form" onSubmit={create}>
        <label>Client name<input id="client-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="My Claude assistant" /></label>
        <label>Client type<select value={type} onChange={(event) => setType(event.target.value as typeof type)}>{clientTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <fieldset><legend>Permissions</legend><div className="control-checks">{scopeOptions.map((option) => <label key={option.value}><input type="checkbox" checked={scopes.includes(option.value)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))} />{option.label}</label>)}</div></fieldset>
        <div className="control-form-pair"><label>Maximum per request · USDC<input type="number" inputMode="decimal" min="0.000001" step="0.000001" value={max} onChange={(event) => setMax(event.target.value)} required /></label><label>24-hour request limit · USDC<input type="number" inputMode="decimal" min="0.000001" step="0.000001" value={daily} onChange={(event) => setDaily(event.target.value)} required /></label></div>
        <p className="control-note">Only official Pre-IPO (PreStocks) requests are eligible. Every request needs your approval. Approval never signs or executes a transaction.</p>
        <button className="button" type="submit" disabled={busy || scopes.length === 0}>{busy ? "Creating…" : "Create client"}</button>
      </form>
    </section>
    {feedback && <p role="status" className="control-feedback">{feedback}</p>}
    {selected && <section className="surface control-panel"><div className="surface-header"><h2>Grant policy</h2><button className="secondary-button" type="button" onClick={() => { setSelected(null); setPolicy(null); }}>Close</button></div>
      {!policy ? <div className="control-state" role="status">Loading policy…</div> : <form className="control-form" onSubmit={savePolicy}>
        <p className="control-note">Version {policy.version} · {policy.approvalMode.replaceAll("_", " ")} · Provider: PreStocks · Market: Pre-IPO</p>
        <fieldset><legend>Permissions</legend><div className="control-checks">{scopeOptions.map((option) => <label key={option.value}><input type="checkbox" checked={policyScopes.includes(option.value)} onChange={(event) => setPolicyScopes((current) => event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))} />{option.label}</label>)}</div></fieldset>
        <div className="control-form-pair"><label>Maximum per request · USDC<input type="number" min="0.000001" step="0.000001" value={policyMax} onChange={(event) => setPolicyMax(event.target.value)} required /></label><label>24-hour request limit · USDC<input type="number" min="0.000001" step="0.000001" value={policyDaily} onChange={(event) => setPolicyDaily(event.target.value)} required /></label></div>
        <button className="button" type="submit" disabled={busy || policyScopes.length === 0}>{busy ? "Saving…" : "Save policy"}</button>
      </form>}
    </section>}
  </div>;
}
