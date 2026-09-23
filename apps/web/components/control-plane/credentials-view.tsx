"use client";

import Link from "next/link";
import { useState } from "react";
import { PrivyCredentials } from "@/components/privy/privy-credentials";
import { ClientRecord, Credential, controlFetch, formatDate, LoadState, PageHeader, useControlList } from "./shared";

type Issued = { id: string; clientId: string; displayPrefix: string; expiresAt: string; secret: string };

export function CredentialsView() {
  const clients = useControlList<ClientRecord>("/clients", "clients");
  const credentials = useControlList<Credential>("/credentials", "credentials");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function action(clientId: string, method: "POST" | "PUT" | "DELETE") {
    const client = clients.items?.find((item) => item.id === clientId);
    if (method !== "POST" && !window.confirm(`${method === "PUT" ? "Rotate" : "Revoke"} the credential for ${client?.name ?? "this client"}? The previous key will stop working immediately.`)) return;
    setIssued(null); setBusy(true); setFeedback("");
    try {
      const result = await controlFetch<{ credential?: Issued }>(`/clients/${clientId}/credential`, method);
      if (result.credential) setIssued(result.credential);
      else setFeedback("Credential revoked. Any connected agent must be reconfigured.");
      credentials.reload();
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Credential action failed."); }
    finally { setBusy(false); }
  }

  async function copySecret() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.secret); setFeedback("Credential copied. Store it in your agent client now; it will not be shown again."); }
    catch { setFeedback("Copy failed. Select and copy the key manually before dismissing it."); }
  }

  const activeClients = clients.items?.filter((client) => client.status === "ACTIVE") ?? [];
  return <div className="dashboard-stack">
    <PageHeader title="Credentials" description="Your verified wallet and revocable agent keys. Private wallet keys are never shown." action={<Link className="secondary-button" href="/clients">Manage agents</Link>} />
    <PrivyCredentials embedded />
    <section className="surface control-panel"><div className="surface-header"><h2>Agent credentials</h2><span className="control-muted">One active key per client · expires after 90 days</span></div>
      {clients.error && <p className="control-state" role="alert">{clients.error} <button type="button" className="secondary-button" onClick={clients.reload}>Try again</button></p>}
      {!clients.items && !clients.error && <p className="control-state" role="status">Loading clients…</p>}
      {clients.items && clients.items.length === 0 && <div className="control-state">Create a client before issuing a key. <Link href="/clients" className="text-link">Create client</Link></div>}
      {activeClients.length > 0 && <div className="control-list">{activeClients.map((client) => {
        const current = credentials.items?.find((entry) => entry.clientId === client.id && entry.status === "ACTIVE");
        return <article className="control-row" key={client.id}><div className="control-row-main"><strong>{client.name}</strong><span>{current ? `${current.displayPrefix}… · Expires ${formatDate(current.expiresAt)} · Used ${formatDate(current.lastUsedAt)}` : "No active credential"}</span></div>
          <div className="control-row-actions">{current ? <><button type="button" className="secondary-button" disabled={busy} onClick={() => void action(client.id, "PUT")}>Rotate</button><button type="button" className="secondary-button control-danger" disabled={busy} onClick={() => void action(client.id, "DELETE")}>Revoke</button></> : <button type="button" className="button" disabled={busy} onClick={() => void action(client.id, "POST")}>Issue key</button>}</div>
        </article>;
      })}</div>}
      <LoadState items={credentials.items} error={credentials.error} retry={credentials.reload} empty="No agent key has been issued." />
    </section>
    {issued && <section className="surface control-secret" role="status"><h2>Save this key now</h2><p>This bearer credential is shown once. Anyone holding it can use the granted MCP permissions. Do not share it in chat, logs, URLs, or screenshots.</p>
      <label>New key<input readOnly value={issued.secret} onFocus={(event) => event.target.select()} autoComplete="off" spellCheck={false} /></label>
      <div className="control-row-actions"><button type="button" className="button" onClick={() => void copySecret()}>Copy key</button><button type="button" className="secondary-button" onClick={() => setIssued(null)}>I saved it</button></div>
    </section>}
    {feedback && <p role="status" className="control-feedback">{feedback}</p>}
    <section className="surface control-panel"><div className="surface-header"><h2>Connect your agent</h2></div><div className="control-instructions">
      <p>Use the hosted Streamable HTTP MCP endpoint. Configure a bearer token in your client’s secure credential field, then enable only the permissions you intend to use.</p>
      <code>https://stockpilot.endpx.cloud/api/mcp</code>
      <div className="control-instruction-grid"><p><strong>Claude Code</strong><br />Add a remote HTTP MCP server with the endpoint above and an Authorization bearer header.</p><p><strong>Codex</strong><br />Add a custom Streamable HTTP MCP server and store the token in your local MCP credentials.</p><p><strong>Cursor</strong><br />Add a remote MCP server using the endpoint and bearer authentication.</p><p><strong>Custom client</strong><br />Send <code>Authorization: Bearer &lt;your-key&gt;</code> over HTTPS.</p></div>
      <p className="control-note">The six tools can read markets/portfolio and submit or inspect investment requests. Approval does not execute or sign a trade.</p>
    </div></section>
  </div>;
}
