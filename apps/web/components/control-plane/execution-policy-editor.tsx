"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentWalletPolicy, AgentWalletPolicyInput } from "@/lib/control-plane/agent-operations";
import { EXECUTION_POLICY_ASSETS, executionAmountDisplay, executionPolicyActions, executionPolicyConfirmation, executionPolicyDraft,
  executionPolicyInput, type ExecutionLimitDraft, type ExecutionPolicyDraft } from "@/lib/control-plane/execution-policy-format";
import { ConfirmDialog } from "./confirm-dialog";
import { controlFetch, formatDate } from "./shared";

function LimitFields({ label, unit, value, onChange, disabled }: {
  label: string; unit: string; value: ExecutionLimitDraft; onChange: (value: ExecutionLimitDraft) => void; disabled: boolean;
}) {
  return <fieldset disabled={disabled}><legend>{label} limits · {unit}</legend>
    <div className="control-form-pair">
      <div className="agent-limit-field"><label>Per operation · {unit}<input type="text" inputMode="decimal"
        value={value.perOperation} disabled={value.unlimitedPerOperation} required={!value.unlimitedPerOperation}
        onChange={(event) => onChange({ ...value, perOperation: event.target.value })} /></label>
        <label className="agent-unlimited-option"><input type="checkbox" checked={value.unlimitedPerOperation}
          onChange={(event) => onChange({ ...value, unlimitedPerOperation: event.target.checked })} />Unlimited per operation</label></div>
      <div className="agent-limit-field"><label>Rolling 24 hours · {unit}<input type="text" inputMode="decimal"
        value={value.daily} disabled={value.unlimitedDaily} required={!value.unlimitedDaily}
        onChange={(event) => onChange({ ...value, daily: event.target.value })} /></label>
        <label className="agent-unlimited-option"><input type="checkbox" checked={value.unlimitedDaily}
          onChange={(event) => onChange({ ...value, unlimitedDaily: event.target.checked })} />Unlimited over 24 hours</label></div>
    </div>
  </fieldset>;
}

export function ExecutionPolicyForm({ policy, clientName, busy, error, onSave, onCancel }: {
  policy: AgentWalletPolicy; clientName: string; busy: boolean; error: string;
  onSave: (candidate: AgentWalletPolicyInput) => Promise<void>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ExecutionPolicyDraft>(() => executionPolicyDraft(policy));
  const [validationError, setValidationError] = useState("");
  const [pending, setPending] = useState<AgentWalletPolicyInput | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const patch = (value: Partial<ExecutionPolicyDraft>) => setDraft((current) => ({ ...current, ...value }));
  const trading = draft.buyEnabled || draft.sellEnabled;
  const transfers = draft.transferSolEnabled || draft.transferUsdcEnabled;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setValidationError("");
    try {
      const input = executionPolicyInput(draft);
      if (input.automationOptIn) setPending(input);
      else void onSave(input);
    } catch (cause) { setValidationError(cause instanceof Error ? cause.message : "Check the execution policy."); }
  }

  return <form className="control-form agent-policy-editor" onSubmit={submit}>
    <p className="control-note">Execution policy version {policy.version}. These permissions are separate from read access and approval requests.</p>
    <label className="agent-unlimited-option"><input type="checkbox" checked={draft.automationOptIn} disabled={busy}
      onChange={(event) => patch({ automationOptIn: event.target.checked })} />Allow this agent to transact without per-transaction approval</label>
    <fieldset disabled={busy}><legend>Independent wallet actions</legend>
      {([
        ["buyEnabled", "BUY supported stocks and Pre-IPO"], ["sellEnabled", "SELL supported stocks and Pre-IPO"],
        ["transferSolEnabled", "Transfer SOL"], ["transferUsdcEnabled", "Transfer USDC"],
      ] as const).map(([key, label]) => <label key={key} className="agent-unlimited-option"><input type="checkbox"
        checked={draft[key]} onChange={(event) => patch({ [key]: event.target.checked })} />{label}</label>)}
      <p className="control-note">Unchecked actions are disabled in this execution policy. Existing approval-request access remains separate.</p>
    </fieldset>
    {trading && <fieldset disabled={busy}><legend>Allowed assets</legend>
      {EXECUTION_POLICY_ASSETS.map((asset) => <label className="agent-unlimited-option" key={asset.id}><input type="checkbox"
        checked={draft.allowedAssetIds.includes(asset.id)} onChange={(event) => patch({ allowedAssetIds: event.target.checked
          ? [...draft.allowedAssetIds, asset.id] : draft.allowedAssetIds.filter((id) => id !== asset.id) })} />{asset.label}</label>)}
      <p className="control-note">Only these verified Solana products are supported by this release. Other market listings are not an execution grant.</p>
    </fieldset>}
    {draft.buyEnabled && <LimitFields label="BUY" unit="USDC" value={draft.buyLimit} disabled={busy} onChange={(buyLimit) => patch({ buyLimit })} />}
    {draft.sellEnabled && EXECUTION_POLICY_ASSETS.filter((asset) => draft.allowedAssetIds.includes(asset.id)).map((asset) =>
      <LimitFields key={asset.id} label={`SELL ${asset.label}`} unit={asset.unit} value={draft.sellLimits[asset.id]} disabled={busy}
        onChange={(limit) => patch({ sellLimits: { ...draft.sellLimits, [asset.id]: limit } })} />)}
    {draft.sellEnabled && <p className="control-note">SELL limits use base token amounts before any scaled-UI multiplier, not dollar value. AAPLx display holdings can differ from these units.</p>}
    {draft.transferSolEnabled && <LimitFields label="Transfer SOL" unit="SOL" value={draft.transferSolLimit} disabled={busy} onChange={(transferSolLimit) => patch({ transferSolLimit })} />}
    {draft.transferUsdcEnabled && <LimitFields label="Transfer USDC" unit="USDC" value={draft.transferUsdcLimit} disabled={busy} onChange={(transferUsdcLimit) => patch({ transferUsdcLimit })} />}
    {transfers && <fieldset disabled={busy}><legend>Transfer recipients</legend>
      <label className="agent-unlimited-option"><input type="checkbox" checked={draft.anyRecipient}
        onChange={(event) => patch({ anyRecipient: event.target.checked })} />Allow any supported wallet recipient</label>
      <label>Allowed Solana wallet addresses<input type="text" value={draft.recipientText} disabled={draft.anyRecipient}
        onChange={(event) => patch({ recipientText: event.target.value })} placeholder="Public addresses, separated by commas" /></label>
      <p className="control-note">Transfers send funds out of your wallet. Use standard Solana wallet addresses, not mint addresses, token accounts, or program vaults.</p>
    </fieldset>}
    <fieldset disabled={busy}><legend>Policy expiry</legend>
      <label className="agent-unlimited-option"><input type="checkbox" checked={draft.noExpiry}
        onChange={(event) => patch({ noExpiry: event.target.checked })} />No policy expiry</label>
      {!draft.noExpiry && <label>Expires at · your local time<input type="datetime-local" required value={draft.expiry}
        onChange={(event) => patch({ expiry: event.target.value })} /></label>}
      <p className="control-note">This controls the saved execution grant, not the OAuth token lifetime.</p>
    </fieldset>
    {trading && <fieldset disabled={busy}><legend>Investor eligibility</legend>
      <label>Country of residence<select value={draft.countryCode} onChange={(event) => patch({ countryCode: event.target.value as "" | "ID" })}>
        <option value="">Select your country</option><option value="ID">Indonesia</option></select></label>
      <label className="agent-unlimited-option"><input type="checkbox" checked={draft.nonUsPerson}
        onChange={(event) => patch({ nonUsPerson: event.target.checked })} />I am not a U.S. person.</label>
      <label className="agent-unlimited-option"><input type="checkbox" checked={draft.acceptedTerms}
        onChange={(event) => patch({ acceptedTerms: event.target.checked })} />I have reviewed the issuer terms and accept the risk of total loss.</label>
      <p className="control-note">Not for U.S. persons. Tokenized stocks are issued for non-U.S. investors only and carry risk of total loss. This release supports the Indonesia demo eligibility flow only.</p>
      <p className="control-note"><a className="text-link" href="https://assets.backed.fi/legal-documentation" target="_blank" rel="noreferrer" aria-label="xStocks issuer documents (opens in a new tab)">xStocks issuer documents ↗</a>{" · "}
        <a className="text-link" href="https://url.prestocks.com/terms-of-service" target="_blank" rel="noreferrer" aria-label="PreStocks terms (opens in a new tab)">PreStocks terms ↗</a></p>
    </fieldset>}
    <p className="control-note">Limits apply to principal amounts. Network fees and any token-account rent are additional and checked before signing. An already submitted transaction cannot be cancelled by changing this policy.</p>
    {(validationError || error) && <p className="control-feedback" role="alert">{validationError || error}</p>}
    <div className="agent-detail-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button ref={saveRef} type="submit" className="button" disabled={busy}>{busy ? "Saving…" : "Save execution policy"}</button></div>
    <ConfirmDialog open={pending !== null} title={`Authorize ${clientName}?`}
      description={pending ? executionPolicyConfirmation(clientName, pending) : ""} confirmLabel="Authorize and save" busy={busy}
      onConfirm={() => { if (pending && !busy) void onSave(pending).finally(() => setPending(null)); }}
      onCancel={() => setPending(null)} returnFocusRef={saveRef} />
  </form>;
}

export function ExecutionPolicySummary({ policy, active, walletReady }: {
  policy: AgentWalletPolicy; active: boolean; walletReady: boolean;
}) {
  const expired = policy.expiresAt !== null && Date.parse(policy.expiresAt) <= Date.now();
  const enabled = active && policy.automationOptIn && !expired;
  const limits = [
    ...(policy.buyEnabled ? [{ label: "BUY", unit: "USDC", decimals: 6, limit: policy.buyLimit }] : []),
    ...(policy.sellEnabled ? policy.sellLimits.flatMap((entry) => {
      const asset = EXECUTION_POLICY_ASSETS.find((item) => item.id === entry.assetId);
      return asset ? [{ label: `SELL ${asset.label}`, unit: asset.unit, decimals: asset.decimals, limit: entry.limit }] : [];
    }) : []),
    ...(policy.transferSolEnabled ? [{ label: "Transfer SOL", unit: "SOL", decimals: 9, limit: policy.transferSolLimit }] : []),
    ...(policy.transferUsdcEnabled ? [{ label: "Transfer USDC", unit: "USDC", decimals: 6, limit: policy.transferUsdcLimit }] : []),
  ];
  return <div className="control-form agent-policy-editor">
    <p className="control-note" role="status">{!active ? "This client is inactive; its saved grants cannot execute."
      : expired ? "This execution policy has expired. Update it before using wallet actions."
        : !enabled ? "Automatic wallet actions are off for this agent."
          : walletReady ? "Saved actions may execute without a new approval, within this policy."
            : "Execution permissions are saved. Wallet automation must be connected separately before they can run."}</p>
    <dl className="agent-policy-limits">
      <div><dt>Saved actions</dt><dd>{executionPolicyActions(policy).join(", ") || "None"}</dd></div>
      <div><dt>Policy expiry</dt><dd>{policy.expiresAt ? formatDate(policy.expiresAt) : "No policy expiry"}</dd></div>
      <div><dt>Assets</dt><dd>{EXECUTION_POLICY_ASSETS.filter((asset) => policy.allowedAssetIds.includes(asset.id)).map((asset) => asset.label).join(", ") || "None"}</dd></div>
      <div><dt>Transfer recipients</dt><dd>{policy.anyRecipient ? "Any supported wallet" : `${policy.recipientAllowlist.length} allowed`}</dd></div>
    </dl>
    {limits.length > 0 && <dl className="agent-policy-limits">{limits.map(({ label, unit, decimals, limit }) =>
      <div key={label}><dt>{label} limits</dt><dd>{limit.perOperationRaw === null ? "Unlimited" : `${executionAmountDisplay(limit.perOperationRaw, decimals)} ${unit}`} per operation<br />
        {limit.dailyRaw === null ? "Unlimited" : `${executionAmountDisplay(limit.dailyRaw, decimals)} ${unit}`} over 24 hours</dd></div>)}</dl>}
    <p className="control-note">Version {policy.version}. Wallet automation and this agent's execution policy are separate permissions. Read access and approval requests do not grant automatic spending.</p>
  </div>;
}

export function ExecutionPolicyEditor({ clientId, clientName, active, walletReady, onSaved }: {
  clientId: string; clientName: string; active: boolean; walletReady: boolean; onSaved?: () => void;
}) {
  const [policy, setPolicy] = useState<AgentWalletPolicy | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const endpoint = `/clients/${encodeURIComponent(clientId)}/execution-policy`;
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null); setError(""); setEditing(false); setSaveError("");
    void controlFetch<{ policy: AgentWalletPolicy }>(endpoint, "GET", undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPolicy(result.policy); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Execution policy unavailable."); });
    return () => controller.abort();
  }, [endpoint, revision]);

  async function save(input: AgentWalletPolicyInput) {
    if (!policy || !active || saving.current) return;
    saving.current = true; setBusy(true); setSaveError(""); setFeedback("");
    try {
      const result = await controlFetch<{ policy: AgentWalletPolicy }>(endpoint, "PATCH", { ...input, expectedVersion: policy.version });
      setPolicy(result.policy); setEditing(false); onSaved?.();
      setFeedback("Execution policy saved. No transaction was initiated by this change.");
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Execution policy could not be saved. Reload and try again."); }
    finally { saving.current = false; setBusy(false); }
  }

  return <section className="surface control-panel">
    <div className="surface-header"><div><span className="agent-detail-kicker">Wallet execution</span><h2>Automatic actions</h2></div>
      {active && policy && !editing && <button className="secondary-button" type="button" onClick={() => { setFeedback(""); setEditing(true); }}>Edit execution policy</button>}</div>
    {error ? <div className="control-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div>
      : !policy ? <div className="control-state" role="status">Loading execution policy…</div>
        : editing && active ? <ExecutionPolicyForm key={policy.version} policy={policy} clientName={clientName} busy={busy} error={saveError}
          onSave={save} onCancel={() => { setEditing(false); setSaveError(""); }} />
          : <ExecutionPolicySummary policy={policy} active={active} walletReady={walletReady} />}
    {saveError && <div className="control-form"><button className="text-link" type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Reload current execution policy</button></div>}
    {feedback && <p className="control-form control-note" role="status">{feedback}</p>}
  </section>;
}
