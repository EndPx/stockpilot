import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrivyWalletCard } from "../components/privy/privy-wallet-card";
import { ThemeToggle } from "../components/theme-toggle";
import { ActivityWeekChart } from "../components/control-plane/activity-preview";
import { WalletOverviewCard } from "../components/privy/wallet-overview-card";
import { AgentsPreviewList } from "../components/control-plane/agents-preview";

test("compact overview wallet shows only verified public identity and safe actions", () => {
  const html = renderToStaticMarkup(createElement(PrivyWalletCard, {
    address: "6EuMFHPtiyoFtsBTy1hiJpNgupP7qKzfZm9ErQ58ipsC",
    compact: true,
  }));
  assert.match(html, /Public Solana address/);
  assert.match(html, /6EuMFHPtiyoFtsBTy1hiJpNgupP7qKzfZm9ErQ58ipsC/);
  assert.match(html, /Copy address/);
  assert.match(html, /solscan\.io\/account/);
  assert.doesNotMatch(html, /Created through Privy|private key|Phantom/i);
});

test("theme control starts from the documented dark default with an accessible action", () => {
  const html = renderToStaticMarkup(createElement(ThemeToggle));
  assert.match(html, /aria-label="Switch to light mode"/);
  assert.match(html, /Light mode/);
});

test("overview activity exposes each UTC day for hover, focus, and tap inspection", () => {
  const week = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${String(19 + index).padStart(2, "0")}`,
    activityCount: index === 6 ? 2 : 0,
    approvalCount: index === 6 ? 1 : 0,
  }));
  const html = renderToStaticMarkup(createElement(ActivityWeekChart, { week }));
  assert.match(html, /3<\/strong>/);
  assert.match(html, /events in the last 7 days/);
  assert.match(html, /Daily breakdown/);
  assert.match(html, /Hover, focus, or tap a day/);
  assert.match(html, /aria-label="2026-09-25 UTC: 3 events; Activity 2; Approvals 1"/);
  assert.match(html, /aria-label="2026-09-19 UTC: 0 events; Activity 0; Approvals 0"/);
  assert.equal((html.match(/class="activity-week-hit"/g) ?? []).length, 7);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 7);
  assert.equal((html.match(/class="activity-week-track"/g) ?? []).length, 7);
  assert.doesNotMatch(html, /price|investment performance/i);
});

test("overview activity explains an empty week rather than displaying an unlabeled blank chart", () => {
  const week = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${String(19 + index).padStart(2, "0")}`,
    activityCount: 0,
    approvalCount: 0,
  }));
  const html = renderToStaticMarkup(createElement(ActivityWeekChart, { week }));
  assert.match(html, /No activity in the last 7 days/);
  assert.doesNotMatch(html, /class="activity-week-track"/);
});

test("overview wallet shows a verified address and never turns a balance failure into zero", () => {
  const address = "6EuMFHPtiyoFtsBTy1hiJpNgupP7qKzfZm9ErQ58ipsC";
  const failed = renderToStaticMarkup(createElement(WalletOverviewCard, {
    address, balance: { kind: "error", message: "Balance unavailable." }, retry: () => undefined,
  }));
  assert.match(failed, /Balance unavailable/);
  assert.match(failed, /6EuMFHPtiyoFtsBTy1hiJpNgupP7qKzfZm9ErQ58ipsC/);
  assert.match(failed, /href="\/wallet"/);
  assert.doesNotMatch(failed, /\$0\.00|Investments|Legacy agent keys/);
});

test("overview agents link to real client details and keep unused status honest", () => {
  const html = renderToStaticMarkup(createElement(AgentsPreviewList, { active: [{
    id: "00000000-0000-0000-0000-000000000001", name: "Codex", clientType: "CUSTOM", status: "ACTIVE",
    createdAt: "2026-09-25T00:00:00.000Z", lastUsedAt: null, expiresAt: null,
    oauthConnectedAt: "2026-09-25T00:00:00.000Z", oauthRevokedAt: null,
    authMethods: ["oauth"], scopes: ["markets:read"],
  }] }));
  assert.match(html, /href="\/clients\/00000000-0000-0000-0000-000000000001"/);
  assert.match(html, /1 active agent/);
  assert.match(html, /Not used yet/);
  assert.doesNotMatch(html, /Last used Never|Full access/);
});
