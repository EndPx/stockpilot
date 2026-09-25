"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { Credential, controlFetch, formatDate, useControlList } from "./shared";

type Issued = { id: string; clientId: string; displayPrefix: string; expiresAt: string; secret: string };

export function LegacyAgentKeys() {
  const credentials = useControlList<Credential>("/credentials", "credentials");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pendingAction, setPendingAction] = useState<{ credential: Credential; method: "PUT" | "DELETE" } | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const active = credentials.items?.filter((entry) => entry.status === "ACTIVE") ?? [];

  async function action(credential: Credential, method: "PUT" | "DELETE") {
    if (busy) return;
    setIssued(null); setBusy(true); setFeedback("");
    try {
      const result = await controlFetch<{ credential?: Issued }>(`/clients/${credential.clientId}/credential`, method);
      if (result.credential) {
        setIssued(result.credential);
        returnFocusRef.current = headingRef.current;
      }
      else {
        setFeedback("Legacy key revoked. The AI app must reconnect with OAuth if it needs access.");
        returnFocusRef.current = headingRef.current;
      }
      credentials.reload();
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Key action failed."); }
    finally { setBusy(false); setPendingAction(null); }
  }

  async function copySecret() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.secret); setFeedback("Key copied. Store it in the agent client now; it will not be shown again."); }
    catch { setFeedback("Copy failed. Select and copy the key manually before dismissing it."); }
  }

  if (!credentials.error && (!credentials.items || active.length === 0) && !feedback && !issued && !pendingAction) return null;
  return <section className="surface control-panel" aria-labelledby="legacy-agent-keys-heading">
    <div className="surface-header"><div><h2 ref={headingRef} tabIndex={-1} id="legacy-agent-keys-heading">Legacy agent keys</h2><p className="control-note">Existing bearer keys only. New agent connections use OAuth.</p></div></div>
    {credentials.error ? <div className="control-state" role="alert"><p>Legacy key status is unavailable: {credentials.error}</p><button type="button" className="secondary-button" onClick={credentials.reload}>Try again</button></div>
      : <div className="control-list">{active.map((credential) => <article className="control-row" key={credential.id}>
        <div className="control-row-main"><strong>{credential.clientName}</strong><span>{credential.displayPrefix}… · Expires {formatDate(credential.expiresAt)} · Used {formatDate(credential.lastUsedAt)}</span></div>
        <div className="control-row-actions"><button type="button" className="secondary-button" disabled={busy} onClick={(event) => { returnFocusRef.current = event.currentTarget; setPendingAction({ credential, method: "PUT" }); }}>Rotate</button><button type="button" className="secondary-button control-danger" disabled={busy} onClick={(event) => { returnFocusRef.current = event.currentTarget; setPendingAction({ credential, method: "DELETE" }); }}>Revoke</button></div>
      </article>)}</div>}
    {issued && <div className="control-secret" role="status"><h3>Save this key now</h3><p>This bearer key is shown once. Anyone holding it can use the granted MCP permissions. Do not share it in chat, logs, URLs, or screenshots.</p>
      <label>New key<input readOnly value={issued.secret} onFocus={(event) => event.target.select()} autoComplete="off" spellCheck={false} /></label>
      <div className="control-row-actions"><button type="button" className="button" onClick={() => void copySecret()}>Copy key</button><button type="button" className="secondary-button" onClick={() => setIssued(null)}>I saved it</button></div>
    </div>}
    {feedback && <p role="status" className="control-feedback">{feedback}</p>}
    <ConfirmDialog
      open={pendingAction !== null}
      title={pendingAction?.method === "PUT" ? "Rotate legacy key?" : "Revoke legacy key?"}
      description={pendingAction ? `${pendingAction.credential.clientName}'s current key will stop working immediately. ${pendingAction.method === "PUT" ? "A replacement key will be shown only once." : "The agent will need to reconnect with OAuth to regain access."}` : ""}
      confirmLabel={pendingAction?.method === "PUT" ? "Rotate key" : "Revoke key"}
      variant="danger"
      busy={busy}
      onConfirm={() => { if (pendingAction) void action(pendingAction.credential, pendingAction.method); }}
      onCancel={() => setPendingAction(null)}
      returnFocusRef={returnFocusRef}
    />
  </section>;
}
