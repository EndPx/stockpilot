"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ClientRecord, Policy, controlFetch, formatDate, LoadState, PageHeader, useControlList } from "./shared";

type OAuthStatus = { enabled: boolean; mcpUrl: string };
type Host = "chatgpt" | "claude" | "codex";

const hosts: { id: Host; label: string; hint: string; steps: string[] }[] = [
  { id: "chatgpt", label: "ChatGPT", hint: "Custom connector", steps: [
    "In ChatGPT on the web, enable developer mode and add a custom MCP connector.",
    "Paste the StockPilot server URL below and select OAuth when asked for authentication.",
    "Connect the connector. Sign in to StockPilot when ChatGPT requests access, then ask it to list StockPilot markets.",
  ] },
  { id: "claude", label: "Claude", hint: "Connector settings", steps: [
    "Open Claude’s connector settings and add a custom connector.",
    "Paste the StockPilot server URL below and save the connector.",
    "Choose Connect. Complete browser authorization, then ask Claude to list StockPilot markets.",
  ] },
  { id: "codex", label: "Codex", hint: "Remote MCP server", steps: [
    "Add a custom remote MCP server in your Codex MCP settings.",
    "Use the StockPilot server URL below and OAuth authentication, not a key in the URL.",
    "Complete browser sign-in when Codex requests authorization, then ask Codex to list StockPilot markets.",
  ] },
];

function HostMark({ host }: { host: Host }) {
  const images: Record<Host, string> = {
    chatgpt: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/e6/9a/0e/e69a0e54-a15f-4b2a-cb42-84788edb896e/AppIcon-0-0-1x_U007epad-0-0-0-1-0-P3-85-220.png/256x256bb.png",
    claude: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/a9/40/3a/a9403a63-cb4d-517c-2f12-44ebe9175936/AppIcon-0-0-1x_U007epad-0-1-85-220.png/256x256bb.png",
    codex: "https://images.ctfassets.net/kftzwdyauwt9/7E1L5KrvfinYdmBBNDPhf5/710a8a46258bafe8fe2d26f31ff242c0/Codex_Landing_Page_SEO.png?fit=thumb&w=256&h=256&f=center&fm=png",
  };
  return <span className={`agent-host-mark agent-host-mark-${host}`} aria-hidden="true">
    <img src={images[host]} width="256" height="256" alt="" loading="lazy" referrerPolicy="no-referrer" />
  </span>;
}

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
  const [host, setHost] = useState<Host | null>(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const selectedHost = hosts.find((item) => item.id === host) ?? hosts[0];

  function openGuide(selected: Host, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setHost(selected);
    setCopyFeedback("");
    dialogRef.current?.showModal();
  }

  function closeGuide() { dialogRef.current?.close(); }

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
    <div className="surface-header"><h2>Connect an agent</h2></div>
    {error ? <div className="control-state" role="alert"><p>Could not check OAuth availability: {error}</p><button type="button" className="secondary-button" onClick={retry}>Try again</button></div>
      : !status ? <div className="control-state" role="status">Checking secure connection availability…</div>
      : !status.enabled ? <div className="control-state" role="status"><p>OAuth connection setup is pending. New agent connections are not available yet. Existing clients and credentials remain manageable below.</p></div>
      : <>
        <div className="agent-presets" role="group" aria-label="Choose an AI app">
          {hosts.map((item) => <button aria-haspopup="dialog" aria-expanded={host === item.id} key={item.id} type="button" onClick={(event) => openGuide(item.id, event.currentTarget)}>
            <HostMark host={item.id} />
            <span className="agent-preset-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>
            <span className="agent-preset-arrow" aria-hidden="true">↗</span>
          </button>)}
        </div>
        <dialog ref={dialogRef} className="agent-connect-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onClose={() => { setHost(null); setCopyFeedback(""); triggerRef.current?.focus(); }}>
          <div className="agent-dialog-body">
            <button type="button" className="wallet-dialog-close" aria-label="Close agent connection guide" onClick={closeGuide}>×</button>
            <div className="agent-dialog-heading"><HostMark host={selectedHost.id} /><div><h2 id={titleId}>Connect with {selectedHost.label}</h2><p id={descriptionId}>Complete OAuth in {selectedHost.label} to grant access. Adding the URL alone does not connect an agent.</p></div></div>
            <ol className="agent-connect-steps">{selectedHost.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <div className="agent-endpoint-row"><code aria-label="StockPilot MCP server URL">{status.mcpUrl}</code><button type="button" className="secondary-button" onClick={() => void copyUrl()}>Copy server URL</button></div>
            {copyFeedback && <p className="control-feedback" role="status">{copyFeedback}</p>}
            <p className="agent-dialog-note">Do not put an API key in the URL. New agents can read markets only; enable portfolio access or BUY requests in Settings after connection. Approval does not sign or execute a trade.</p>
          </div>
        </dialog>
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
      <LoadState items={items} error={error} retry={reload} empty="No agent has made an authorized tool request yet. After browser authorization, ask your AI app to list StockPilot markets, then refresh." />
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
