"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ClientRecord, Policy, controlFetch, formatDate, LoadState, PageHeader, useControlList } from "./shared";

type OAuthStatus = { enabled: boolean; mcpUrl: string };
type Host = "chatgpt" | "claude" | "codex";

const hosts: { id: Host; label: string; steps: string[] }[] = [
  { id: "chatgpt", label: "ChatGPT", steps: [
    "In ChatGPT on the web, enable developer mode and add a custom MCP connector.",
    "Paste the StockPilot server URL below and select OAuth when asked for authentication.",
    "Connect the connector. Sign in to StockPilot in the browser when a protected tool requests access, then return to ChatGPT.",
  ] },
  { id: "claude", label: "Claude", steps: [
    "Open Claude’s connector settings and add a custom connector.",
    "Paste the StockPilot server URL below and save the connector.",
    "Choose Connect. Complete the StockPilot sign-in and authorization in the browser, then return to Claude.",
  ] },
  { id: "codex", label: "Codex", steps: [
    "Add a custom remote MCP server in your Codex MCP settings.",
    "Use the StockPilot server URL below and OAuth authentication, not a key in the URL.",
    "Complete browser sign-in when Codex requests authorization, then return to Codex.",
  ] },
];

const readScopes = [
  { value: "markets:read", label: "Read markets" },
  { value: "portfolio:read", label: "Read portfolio" },
  { value: "requests:read-own", label: "Read this agent’s requests" },
];
const readScopeValues = readScopes.map((option) => option.value);
const permissionPresets = [
  { label: "Read only", scopes: readScopeValues },
  { label: "Request only", scopes: ["investments:request"] },
  { label: "Read + request", scopes: [...readScopeValues, "investments:request"] },
];

function scopesMatch(current: string[], expected: string[]) {
  return current.length === expected.length && expected.every((scope) => current.includes(scope));
}

export function AgentConnectionGuide({ status, error, retry }: {
  status: OAuthStatus | null; error: string; retry: () => void;
}) {
  const [host, setHost] = useState<Host>("chatgpt");
  const [copyFeedback, setCopyFeedback] = useState("");
  const selectedHost = hosts.find((item) => item.id === host) ?? hosts[0];

  async function copyUrl() {
    if (!status?.enabled) return;
    try {
      await navigator.clipboard.writeText(status.mcpUrl);
      setCopyFeedback("Server URL copied. Connection still requires sign-in and authorization in your AI app.");
    } catch {
      setCopyFeedback("Copy failed. Select and copy the URL manually.");
    }
  }

  return <section className="surface control-panel">
    <div className="surface-header"><h2>Connect an agent</h2><span className="control-muted">Browser sign-in · no API key to paste</span></div>
    {error ? <div className="control-state" role="alert"><p>Could not check OAuth availability: {error}</p><button type="button" className="secondary-button" onClick={retry}>Try again</button></div>
      : !status ? <div className="control-state" role="status">Checking secure connection availability…</div>
      : !status.enabled ? <div className="control-state" role="status"><p>OAuth connection setup is pending. New agent connections are not available yet. Existing clients and credentials remain manageable below.</p></div>
      : <>
        <div className="agent-presets" role="group" aria-label="Choose an AI app">
          {hosts.map((item) => <button aria-pressed={host === item.id} className={host === item.id ? "agent-preset-active" : ""} key={item.id} type="button" onClick={() => { setHost(item.id); setCopyFeedback(""); }}>{item.label}</button>)}
        </div>
        <div className="control-instructions" role="region" aria-label={`${selectedHost.label} connection instructions`}>
          <p>Set up StockPilot in {selectedHost.label}. Adding the URL does not grant access; the AI app must complete OAuth and receive your authorization.</p>
          <ol className="agent-connect-steps">{selectedHost.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="agent-endpoint-row"><code aria-label="StockPilot MCP server URL">{status.mcpUrl}</code><button type="button" className="secondary-button" onClick={() => void copyUrl()}>Copy server URL</button></div>
          <p className="control-note">Do not put an API key in the URL. New agents can read markets only; enable portfolio access or BUY requests in Settings after connection. Approval does not sign or execute a trade.</p>
          {copyFeedback && <p className="control-feedback" role="status">{copyFeedback}</p>}
        </div>
      </>}
  </section>;
}

export function ClientsView() {
  const { items, error, reload } = useControlList<ClientRecord>("/clients", "clients");
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus | null>(null);
  const [oauthError, setOAuthError] = useState("");
  const [oauthRevision, setOauthRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [policyMax, setPolicyMax] = useState("");
  const [policyDaily, setPolicyDaily] = useState("");
  const [maxUnlimited, setMaxUnlimited] = useState(false);
  const [dailyUnlimited, setDailyUnlimited] = useState(false);
  const [policyScopes, setPolicyScopes] = useState<string[]>([]);
  const policyRequestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setOAuthStatus(null); setOAuthError("");
    fetch("/api/control/oauth-status", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The OAuth status service is unavailable.");
        const status = await response.json() as OAuthStatus;
        if (!status.enabled || !status.mcpUrl.startsWith("https://")) return { enabled: false, mcpUrl: "" };
        return status;
      })
      .then((status) => { if (!controller.signal.aborted) setOAuthStatus(status); })
      .catch((cause) => { if (!controller.signal.aborted) setOAuthError(cause instanceof Error ? cause.message : "Unable to check OAuth status."); });
    return () => controller.abort();
  }, [oauthRevision]);

  const loadPolicy = useCallback(async (id: string) => {
    const requestId = ++policyRequestId.current;
    setSelected(id); setPolicy(null); setPolicyError(""); setFeedback("");
    try {
      const result = await controlFetch<{ policy: Policy }>(`/clients/${id}/policy`);
      if (requestId !== policyRequestId.current) return;
      setPolicy(result.policy); setPolicyMax(result.policy.maxInvestmentUsd ?? "10");
      setPolicyDaily(result.policy.dailyRequestLimitUsd ?? "50");
      setMaxUnlimited(result.policy.maxInvestmentUsd === null);
      setDailyUnlimited(result.policy.dailyRequestLimitUsd === null);
      setPolicyScopes(result.policy.scopes);
    } catch (cause) { if (requestId === policyRequestId.current) setPolicyError(cause instanceof Error ? cause.message : "Settings unavailable."); }
  }, []);

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!policy) return;
    const newlyUnlimited = (maxUnlimited && policy.maxInvestmentUsd !== null) || (dailyUnlimited && policy.dailyRequestLimitUsd !== null);
    if (newlyUnlimited && !window.confirm("Remove this agent’s request cap? It can submit uncapped requests, but every investment still requires your approval and cannot execute a trade.")) return;
    setBusy(true); setFeedback("");
    try {
      const result = await controlFetch<{ policy: Policy }>(`/clients/${policy.clientId}/policy`, "PATCH", {
        scopes: policyScopes,
        buyMode: policyScopes.includes("investments:request") ? "APPROVAL" : "DISABLED",
        sellMode: "DISABLED",
        maxInvestmentUsd: maxUnlimited ? null : policyMax,
        dailyRequestLimitUsd: dailyUnlimited ? null : policyDaily,
        expectedVersion: policy.version,
      });
      setPolicy(result.policy);
      setFeedback("Settings saved. Existing requests keep their original permission snapshot.");
      reload();
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Settings update failed. Reload this policy before trying again."); }
    finally { setBusy(false); }
  }

  async function revoke(client: ClientRecord) {
    if (!window.confirm(`Revoke ${client.name}? Its agent access and any legacy credential will stop working immediately.`)) return;
    setBusy(true); setFeedback("");
    try { await controlFetch(`/clients/${client.id}`, "DELETE"); ++policyRequestId.current; setSelected(null); setPolicy(null); setFeedback(`${client.name} revoked.`); reload(); }
    catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Revocation failed."); }
    finally { setBusy(false); }
  }

  return <div className="dashboard-stack">
    <PageHeader title="Agents" description="Connect an AI app with browser authorization, then review what its client can access." action={<Link className="secondary-button" href="/credentials">Credentials</Link>} />
    <AgentConnectionGuide status={oauthStatus} error={oauthError} retry={() => setOauthRevision((value) => value + 1)} />
    <section className="surface control-panel"><div className="surface-header"><h2>Your agents</h2><div className="control-row-actions"><span className="control-muted">{items?.length ?? "—"} clients</span><button type="button" className="secondary-button" onClick={reload}>Refresh</button></div></div>
      <LoadState items={items} error={error} retry={reload} empty="No agents connected yet. Once an AI app completes OAuth, refresh this list." />
      {items && items.length > 0 && <div className="control-list">{items.map((client) => <article className="control-row" key={client.id}>
        <div className="control-row-main"><strong>{client.name}</strong><span>{client.clientType.replaceAll("_", " ")} · {client.scopes.length} permissions · Last used {formatDate(client.lastUsedAt)}</span></div>
        <span className={`control-status ${client.status === "ACTIVE" ? "control-status-active" : ""}`}>{client.status.toLowerCase()}</span>
        <div className="control-row-actions">{client.status === "ACTIVE" && <><button type="button" className="secondary-button" disabled={busy} onClick={() => void loadPolicy(client.id)}>Settings</button><button type="button" className="secondary-button control-danger" disabled={busy} onClick={() => void revoke(client)}>Revoke</button></>}</div>
      </article>)}</div>}
    </section>
    {selected && <section className="surface control-panel"><div className="surface-header"><h2>Agent settings</h2><button className="secondary-button" type="button" onClick={() => { ++policyRequestId.current; setSelected(null); setPolicy(null); setPolicyError(""); }}>Close</button></div>
      {policyError ? <div className="control-state" role="alert"><p>{policyError}</p><button type="button" className="secondary-button" onClick={() => void loadPolicy(selected)}>Try again</button></div>
        : !policy ? <div className="control-state" role="status">Loading settings…</div>
        : <form className="control-form" onSubmit={savePolicy}>
          <p className="control-note">Policy version {policy.version}. Changes affect future requests only.</p>
          <div className="control-filter" role="group" aria-label="Permission quick choices">{permissionPresets.map((preset) => <button key={preset.label} type="button" aria-pressed={scopesMatch(policyScopes, preset.scopes)} className={scopesMatch(policyScopes, preset.scopes) ? "control-filter-active" : ""} onClick={() => setPolicyScopes([...preset.scopes])}>{preset.label}</button>)}</div>
          <fieldset><legend>Read access</legend><div className="control-checks">{readScopes.map((option) => <label key={option.value}><input type="checkbox" checked={policyScopes.includes(option.value)} onChange={(event) => setPolicyScopes((current) => event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))} />{option.label}</label>)}
            {policyScopes.includes("approvals:read-own") && <label><input type="checkbox" checked onChange={() => setPolicyScopes((current) => current.filter((value) => value !== "approvals:read-own"))} />Remove legacy approvals-read grant (no MCP tool)</label>}
          </div></fieldset>
          <fieldset><legend>Investment access</legend><div className="control-checks"><label><input type="checkbox" checked={policyScopes.includes("investments:request")} onChange={(event) => setPolicyScopes((current) => event.target.checked ? [...current, "investments:request"] : current.filter((value) => value !== "investments:request"))} />Request a Pre-IPO BUY for my approval</label></div>
            <p className="control-note">Automatic BUY and SELL are unavailable. An approved request does not sign or execute a transaction.</p>
          </fieldset>
          <div className="control-form-pair">
            <div className="agent-limit-field"><label htmlFor="agent-max">Maximum per request · USDC</label><input id="agent-max" type="number" inputMode="decimal" min="0.000001" step="0.000001" value={policyMax} onChange={(event) => setPolicyMax(event.target.value)} disabled={maxUnlimited} required={!maxUnlimited} /><label className="agent-unlimited-option"><input type="checkbox" checked={maxUnlimited} onChange={(event) => setMaxUnlimited(event.target.checked)} />No per-request cap</label></div>
            <div className="agent-limit-field"><label htmlFor="agent-daily">24-hour request limit · USDC</label><input id="agent-daily" type="number" inputMode="decimal" min="0.000001" step="0.000001" value={policyDaily} onChange={(event) => setPolicyDaily(event.target.value)} disabled={dailyUnlimited} required={!dailyUnlimited} /><label className="agent-unlimited-option"><input type="checkbox" checked={dailyUnlimited} onChange={(event) => setDailyUnlimited(event.target.checked)} />No daily cap</label></div>
          </div>
          <p className="control-note">These caps govern submitted requests, not wallet execution. Removing a cap does not permit an agent to sign or spend funds.</p>
          <button className="button" type="submit" disabled={busy || policyScopes.length === 0}>{busy ? "Saving…" : "Save settings"}</button>
        </form>}
    </section>}
    {feedback && <p role="status" className="control-feedback">{feedback}</p>}
  </div>;
}
