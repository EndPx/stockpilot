"use client";

import Link from "next/link";
import { useState } from "react";
import { PrivyCredentials } from "@/components/privy/privy-credentials";
import { Credential, controlFetch, formatDate, LoadState, PageHeader, useControlList } from "./shared";

type Issued = { id: string; clientId: string; displayPrefix: string; expiresAt: string; secret: string };

export function CredentialsView() {
  const credentials = useControlList<Credential>("/credentials", "credentials");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function action(credential: Credential, method: "PUT" | "DELETE") {
    if (!window.confirm(`${method === "PUT" ? "Rotate" : "Revoke"} the legacy credential for ${credential.clientName}? The previous key will stop working immediately.`)) return;
    setIssued(null); setBusy(true); setFeedback("");
    try {
      const result = await controlFetch<{ credential?: Issued }>(`/clients/${credential.clientId}/credential`, method);
      if (result.credential) setIssued(result.credential);
      else setFeedback("Legacy credential revoked. Any AI app using it must reconnect with OAuth when available.");
      credentials.reload();
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Credential action failed."); }
    finally { setBusy(false); }
  }

  async function copySecret() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.secret); setFeedback("Credential copied. Store it in your agent client now; it will not be shown again."); }
    catch { setFeedback("Copy failed. Select and copy the key manually before dismissing it."); }
  }

  const activeCredentials = credentials.items?.filter((entry) => entry.status === "ACTIVE") ?? [];
  return <div className="dashboard-stack">
    <PageHeader title="Credentials" description="Your verified Solana wallet and existing agent keys. Private wallet keys are never shown." action={<Link className="secondary-button" href="/clients">Manage agents</Link>} />
    <PrivyCredentials embedded />
    <section className="surface control-panel"><div className="surface-header"><h2>Legacy agent keys</h2><span className="control-muted">Existing bearer keys only · new connections use OAuth</span></div>
      {activeCredentials.length > 0 && <div className="control-list">{activeCredentials.map((credential) => {
        return <article className="control-row" key={credential.id}><div className="control-row-main"><strong>{credential.clientName}</strong><span>{credential.displayPrefix}… · Expires {formatDate(credential.expiresAt)} · Used {formatDate(credential.lastUsedAt)}</span></div>
          <div className="control-row-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void action(credential, "PUT")}>Rotate</button><button type="button" className="secondary-button control-danger" disabled={busy} onClick={() => void action(credential, "DELETE")}>Revoke</button></div>
        </article>;
      })}</div>}
      <LoadState items={credentials.items ? activeCredentials : null} error={credentials.error} retry={credentials.reload} empty="No legacy keys. Connect a new agent from the Agents page when OAuth is available." />
    </section>
    {issued && <section className="surface control-secret" role="status"><h2>Save this key now</h2><p>This bearer credential is shown once. Anyone holding it can use the granted MCP permissions. Do not share it in chat, logs, URLs, or screenshots.</p>
      <label>New key<input readOnly value={issued.secret} onFocus={(event) => event.target.select()} autoComplete="off" spellCheck={false} /></label>
      <div className="control-row-actions"><button type="button" className="button" onClick={() => void copySecret()}>Copy key</button><button type="button" className="secondary-button" onClick={() => setIssued(null)}>I saved it</button></div>
    </section>}
    {feedback && <p role="status" className="control-feedback">{feedback}</p>}
  </div>;
}
