"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ClientRecord, controlFetch, formatDate, LoadState, PageHeader, useControlList } from "./shared";
import { agentConnectionLabel } from "./agent-labels";
import { LegacyAgentKeys } from "./legacy-agent-keys";

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

export function HostMark({ host }: { host: Host }) {
  const images: Record<Host, string> = {
    chatgpt: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/e6/9a/0e/e69a0e54-a15f-4b2a-cb42-84788edb896e/AppIcon-0-0-1x_U007epad-0-0-0-1-0-P3-85-220.png/256x256bb.png",
    claude: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/a9/40/3a/a9403a63-cb4d-517c-2f12-44ebe9175936/AppIcon-0-0-1x_U007epad-0-1-85-220.png/256x256bb.png",
    codex: "https://images.ctfassets.net/kftzwdyauwt9/7E1L5KrvfinYdmBBNDPhf5/710a8a46258bafe8fe2d26f31ff242c0/Codex_Landing_Page_SEO.png?fit=thumb&w=256&h=256&f=center&fm=png",
  };
  return <span className={`agent-host-mark agent-host-mark-${host}`} aria-hidden="true">
    <img src={images[host]} width="256" height="256" alt="" loading="lazy" referrerPolicy="no-referrer" />
  </span>;
}

export function AgentMark({ name }: { name: string }) {
  const host = hosts.find((item) => new RegExp(`\\b${item.id}\\b`, "i").test(name));
  return host ? <HostMark host={host.id} /> : <span className="agent-host-mark agent-host-mark-generic" aria-hidden="true">AI</span>;
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
      : !status.enabled ? <div className="control-state" role="status"><p>OAuth connection setup is pending. New agent connections are not available yet. Existing agents and legacy keys remain manageable below.</p></div>
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

export function AgentDirectory({ items, error, reload }: {
  items: ClientRecord[] | null; error: string; reload: () => void;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ id: string; message: string } | null>(null);
  const activeCount = items?.filter((client) => client.status === "ACTIVE" && client.authMethods.length > 0).length;

  async function revoke(client: ClientRecord) {
    if (!window.confirm(`Revoke ${client.name} (${client.id})? Its OAuth access and any legacy credential will stop working.`)) return;
    setRevokingId(client.id);
    setRevokeError(null);
    try {
      await controlFetch(`/clients/${encodeURIComponent(client.id)}`, "DELETE");
      reload();
    } catch (cause) {
      setRevokeError({ id: client.id, message: cause instanceof Error ? cause.message : "Revocation failed. Try again." });
    } finally {
      setRevokingId(null);
    }
  }

  return <section className="agent-directory" aria-labelledby="agent-directory-heading">
    <div className="agent-directory-header"><div className="agent-directory-heading"><h2 id="agent-directory-heading">Agents</h2><span className="control-muted">{activeCount ?? "—"} active</span></div><button type="button" className="secondary-button" onClick={reload}>Refresh</button></div>
    <LoadState items={items} error={error} retry={reload} empty="No agent has made an authorized tool request yet. After browser authorization, ask your AI app to list StockPilot markets, then refresh." />
    {items && items.length > 0 && <div className="agent-card-grid">{items.map((client) => <article className="surface agent-card" key={client.id}>
      <div className="agent-card-identity"><AgentMark name={client.name} /><div className="agent-card-identity-copy"><div className="agent-card-title"><span className={`control-status ${client.status === "ACTIVE" && client.authMethods.length > 0 ? "control-status-active" : ""}`}>{client.status === "ACTIVE" && client.authMethods.length === 0 ? "not connected" : client.status.toLowerCase()}</span><h3>{client.name}</h3></div><span className="agent-card-method">{agentConnectionLabel(client)}</span></div></div>
      <p className="agent-card-meta"><code className="agent-client-id">{client.id.slice(0, 8)}…{client.id.slice(-4)}</code><span aria-hidden="true"> · </span>{client.scopes.length} saved {client.scopes.length === 1 ? "permission" : "permissions"}<span aria-hidden="true"> · </span>{client.lastUsedAt ? `Last used ${formatDate(client.lastUsedAt)}` : "Not used yet"}</p>
      {revokeError?.id === client.id && <p className="control-feedback" role="alert">{revokeError.message}</p>}
      <div className="agent-card-actions"><Link className="text-link" href={`/clients/${client.id}`} aria-label={`View details for ${client.name}`}>Details <span aria-hidden="true">→</span></Link>{client.status === "ACTIVE" && <button type="button" className="secondary-button control-danger" aria-label={`Revoke ${client.name}`} disabled={revokingId !== null} onClick={() => void revoke(client)}>{revokingId === client.id ? "Revoking…" : "Revoke"}</button>}</div>
    </article>)}</div>}
  </section>;
}

export function ClientsView() {
  const { items, error, reload } = useControlList<ClientRecord>("/clients", "clients");
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus | null>(null);
  const [oauthError, setOAuthError] = useState("");
  const [oauthRevision, setOauthRevision] = useState(0);

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

  return <div className="dashboard-stack">
    <PageHeader title="Agents" description="Connect an AI app with browser authorization, then review its access and activity." />
    <AgentConnectionGuide status={oauthStatus} error={oauthError} retry={() => setOauthRevision((value) => value + 1)} />
    <AgentDirectory items={items} error={error} reload={reload} />
    <LegacyAgentKeys />
  </div>;
}
