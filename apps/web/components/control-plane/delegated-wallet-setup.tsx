"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useSigners } from "@privy-io/react-auth";
import type { DelegatedSignerReadiness } from "@/lib/privy/delegated-signer";
import { controlFetch } from "./shared";

type ReadinessResponse = { readiness: DelegatedSignerReadiness; walletAddress: string };
const reasons: Record<DelegatedSignerReadiness["reason"], string> = {
  READY: "Wallet automation is connected. Each agent's policy controls its access.",
  NOT_CONFIGURED: "Wallet automation is awaiting server setup.",
  EXECUTION_DISABLED: "Wallet automation is currently paused.",
  WALLET_MISMATCH: "Your wallet connection changed. Sign in again before enabling automation.",
  OWNER_CONSENT_REQUIRED: "Enable this wallet once to let permitted agents act while you are away.",
  SIGNER_POLICY_MISMATCH: "The wallet's automation permissions need to be reconnected.",
  SIGNER_EXPIRED: "The server's wallet automation authorization has expired. It must be renewed before reconnecting.",
  PRIVY_UNAVAILABLE: "Wallet permissions could not be checked. Try again shortly.",
};

export function DelegatedWalletSetup({ editable, disabled = false, onReadyChange, onBusyChange }: {
  editable: boolean; disabled?: boolean; onReadyChange?: (ready: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const { ready: privyReady, authenticated } = usePrivy();
  const { addSigners } = useSigners();
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const connectionInFlight = useRef(false);
  const refresh = useCallback(async () => {
    const next = await controlFetch<ReadinessResponse>("/execution-readiness");
    setData(next);
    return next;
  }, []);
  useEffect(() => { void refresh().catch(() => setError("Unable to check wallet automation.")); }, [refresh]);
  useEffect(() => { onReadyChange?.(data?.readiness.ready === true); }, [data?.readiness.ready, onReadyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (!editable) setConsent(false); }, [editable]);

  async function enable() {
    if (!editable || disabled || connectionInFlight.current || busy || !consent || !privyReady || !authenticated) return;
    connectionInFlight.current = true;
    setBusy(true); setError("");
    try {
      const current = await refresh();
      const status = current.readiness;
      if (!status.configured || !status.enabled || !status.signerId || !status.policyId ||
          !["OWNER_CONSENT_REQUIRED", "SIGNER_POLICY_MISMATCH"].includes(status.reason)) return;
      await addSigners({ address: current.walletAddress,
        signers: [{ signerId: status.signerId, policyIds: [status.policyId] }] });
      const verified = await refresh();
      if (!verified.readiness.ready) setError("Permission was requested, but the server has not verified it yet. Refresh to check.");
      setConsent(false);
    } catch { setError("Wallet permission was not confirmed. Refresh and try again when you are ready."); }
    finally { connectionInFlight.current = false; setBusy(false); }
  }

  const status = data?.readiness;
  const canEnable = status?.configured && status.enabled &&
    ["OWNER_CONSENT_REQUIRED", "SIGNER_POLICY_MISMATCH"].includes(status.reason);
  return <div className="control-form agent-wallet-permission">
    <fieldset disabled={disabled || busy}><legend>Wallet automation</legend>
      <span className={`control-status ${status?.ready ? "control-status-active" : ""}`}>{status ? status.ready ? "Connected" : "Not connected" : "Checking…"}</span>
      <p className="control-note" role="status">{status ? reasons[status.reason] : "Checking wallet permissions…"}</p>
      {editable && <>
      <p className="control-note">This one-time wallet permission is shared by your agents. Each agent can only use its own saved actions, assets and limits. Connecting does not save this policy or send a transaction; cancelling policy edits does not undo a wallet permission you already confirmed.</p>
      {canEnable && <label className="agent-unlimited-option"><input type="checkbox" checked={consent}
        onChange={(event) => setConsent(event.target.checked)} disabled={busy} />
        I allow StockPilot to sign permitted wallet actions while I am away.</label>}
      <div className="agent-detail-actions">
        {!status?.ready && <button className="button" type="button" onClick={() => { void enable(); }}
          disabled={!canEnable || !consent || busy || !privyReady || !authenticated}>{busy ? "Connecting…" : "Enable wallet automation"}</button>}
        <button type="button" className="secondary-button" disabled={busy}
          onClick={() => { setError(""); void refresh().catch(() => setError("Unable to check wallet automation.")); }}>Refresh</button>
      </div>
      </>}
      {error && <p role="alert" className="control-note">{error}</p>}
    </fieldset>
  </div>;
}
