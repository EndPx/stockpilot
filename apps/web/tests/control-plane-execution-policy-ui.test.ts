import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionPolicyForm, ExecutionPolicySummary } from "../components/control-plane/execution-policy-editor";
import { EXECUTION_POLICY_ASSETS, executionAmountDisplay, executionAmountRaw, executionPolicyConfirmation,
  executionPolicyDraft, executionPolicyInput } from "../lib/control-plane/execution-policy-format";
import type { AgentWalletPolicy } from "../lib/control-plane/agent-operations";

const limit = { perOperationRaw: "1000000", dailyRaw: "10000000", unlimitedPerOperation: false, unlimitedDaily: false };
const policy: AgentWalletPolicy = { version: 0, automationOptIn: false, buyEnabled: false, sellEnabled: false,
  transferSolEnabled: false, transferUsdcEnabled: false, allowedAssetIds: [], buyLimit: limit,
  transferSolLimit: limit, transferUsdcLimit: limit, sellLimits: [], recipientAllowlist: [], anyRecipient: false,
  expiresAt: null, eligibility: null, eligibilityAcceptedAt: null, updatedAt: null };

test("execution amounts remain exact at SOL, USDC, and canonical SELL precisions", () => {
  assert.equal(executionAmountRaw("0.003", 9), "3000000");
  assert.equal(executionAmountRaw("0.1", 6), "100000");
  assert.equal(executionAmountRaw("0.00000001", 8), "1");
  assert.equal(executionAmountRaw("18446744073.709551615", 9), "18446744073709551615");
  assert.equal(executionAmountDisplay("18446744073709551615", 9), "18446744073.709551615");
  for (const amount of ["0", "-1", "+1", "1e2", "01", "0.0000001", "18446744073709551616", " 1"]) {
    assert.throws(() => executionAmountRaw(amount, 6));
  }
});

test("default execution draft grants nothing and round trips without inferred consent", () => {
  const draft = executionPolicyDraft(policy);
  assert.equal(draft.automationOptIn, false);
  assert.equal(draft.buyEnabled || draft.sellEnabled || draft.transferSolEnabled || draft.transferUsdcEnabled, false);
  assert.equal(draft.countryCode, ""); assert.equal(draft.nonUsPerson || draft.acceptedTerms, false);
  assert.equal(draft.buyLimit.perOperation, "1"); assert.equal(draft.transferSolLimit.perOperation, "0.001");
  const { version: _version, eligibilityAcceptedAt: _accepted, updatedAt: _updated, ...input } = policy;
  assert.deepEqual(executionPolicyInput(draft), input);
});

test("enabled trading requires assets and owner statements; SELL caps are token raw units", () => {
  const draft = executionPolicyDraft(policy);
  Object.assign(draft, { automationOptIn: true, buyEnabled: true, sellEnabled: true });
  assert.throws(() => executionPolicyInput(draft), /eligibility/);
  Object.assign(draft, { allowedAssetIds: EXECUTION_POLICY_ASSETS.map((asset) => asset.id), countryCode: "ID", nonUsPerson: true, acceptedTerms: true });
  draft.buyLimit.perOperation = "0.10";
  draft.sellLimits[EXECUTION_POLICY_ASSETS[1].id].perOperation = "0.00000001";
  const input = executionPolicyInput(draft);
  assert.equal(input.buyLimit.perOperationRaw, "100000");
  assert.equal(input.sellLimits[1].limit.perOperationRaw, "1");
  assert.equal(input.sellLimits[0].limit.perOperationRaw, "1000000000");
  assert.deepEqual(input.eligibility, { countryCode: "ID", nonUsPerson: true, acceptedTerms: true });
  draft.allowedAssetIds = []; assert.throws(() => executionPolicyInput(draft), /supported asset/);
});

test("transfer grants require recipients; any-recipient and unlimited choices are explicit in confirmation", () => {
  const draft = executionPolicyDraft(policy);
  Object.assign(draft, { automationOptIn: true, transferSolEnabled: true });
  assert.throws(() => executionPolicyInput(draft), /recipient/);
  draft.recipientText = "So11111111111111111111111111111111111111112";
  assert.equal(executionPolicyInput(draft).recipientAllowlist.length, 1);
  draft.recipientText += `, ${draft.recipientText}`;
  assert.throws(() => executionPolicyInput(draft), /unique/);
  draft.anyRecipient = true; draft.transferSolLimit.unlimitedPerOperation = true;
  draft.transferSolLimit.unlimitedDaily = true;
  const candidate = executionPolicyInput(draft);
  assert.deepEqual(candidate.recipientAllowlist, []);
  assert.equal(candidate.transferSolLimit.perOperationRaw, null);
  assert.equal(candidate.transferSolLimit.dailyRaw, null);
  const text = executionPolicyConfirmation("Codex", candidate);
  assert.match(text, /without your approval for each transaction/);
  assert.match(text, /UNLIMITED per operation/); assert.match(text, /UNLIMITED over 24 hours/);
  assert.match(text, /ANY supported wallet recipient/); assert.match(text, /separate permission/);
});

test("policy expiry is a future local datetime and never a silently expired grant", () => {
  const draft = executionPolicyDraft(policy); draft.noExpiry = false;
  for (const value of ["", "invalid", "2020-01-01T00:00"]) {
    draft.expiry = value; assert.throws(() => executionPolicyInput(draft), /future policy expiry/);
  }
  draft.expiry = "2036-01-01T12:34";
  assert.equal(executionPolicyInput(draft).expiresAt, new Date(draft.expiry).toISOString());
});

test("execution form renders independent opt-ins, no key material, and no mutation during rendering", () => {
  let saved = 0;
  const html = renderToStaticMarkup(createElement(ExecutionPolicyForm, { policy, clientName: "Codex", busy: false,
    error: "", onSave: async () => { saved++; }, onCancel: () => undefined }));
  assert.equal(saved, 0);
  assert.match(html, /Allow this agent to transact without per-transaction approval/);
  for (const label of ["BUY supported", "SELL supported", "Transfer SOL", "Transfer USDC"]) assert.match(html, new RegExp(label));
  assert.equal((html.match(/checked=""/g) ?? []).length, 1); // Only the disclosed no-expiry preference.
  assert.match(html, /<dialog/); assert.doesNotMatch(html, /API key|private key|seed phrase/);
  const source = readFileSync(new URL("../components/control-plane/execution-policy-editor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)|addSigners|signTransaction|sendTransaction/);
  assert.match(source, /if \(input.automationOptIn\) setPending\(input\)/);
  assert.match(source, /onCancel=\{\(\) => setPending\(null\)\}/);
});

test("saved execution grants are not presented as a connected wallet or active revoked client", () => {
  const enabled = { ...policy, version: 1, automationOptIn: true, buyEnabled: true };
  const waiting = renderToStaticMarkup(createElement(ExecutionPolicySummary, { policy: enabled, active: true, walletReady: false }));
  assert.match(waiting, /must be connected separately/);
  const revoked = renderToStaticMarkup(createElement(ExecutionPolicySummary, { policy: enabled, active: false, walletReady: true }));
  assert.match(revoked, /inactive; its saved grants cannot execute/);
  const expired = renderToStaticMarkup(createElement(ExecutionPolicySummary, { policy: { ...enabled, expiresAt: "2020-01-01T00:00:00.000Z" }, active: true, walletReady: true }));
  assert.match(expired, /execution policy has expired/);
});
