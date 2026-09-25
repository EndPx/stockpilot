import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentConnectionGuide } from "../components/control-plane/clients-view";
import { AccessSummary } from "../components/control-plane/agent-detail-view";
import { agentConnectionLabel } from "../components/control-plane/agent-labels";
import { OAuthConnectContent } from "../components/oauth-connect-summary";
import type { ClientRecord, Policy } from "../components/control-plane/shared";

test("Agent onboarding does not offer a URL or a false connection before OAuth is available", () => {
  const html = renderToStaticMarkup(createElement(AgentConnectionGuide, {
    status: { enabled: false, mcpUrl: "https://stockpilot.endpx.cloud/api/mcp" },
    error: "", retry: () => undefined,
  }));
  assert.match(html, /OAuth connection setup is pending/);
  assert.doesNotMatch(html, /stockpilot\.endpx\.cloud\/api\/mcp/);
  assert.doesNotMatch(html, /Copy server URL|Connected|Create client|Issue key/);
});

test("ready Agent onboarding names OAuth, host setup, and the server URL without a bearer key", () => {
  const html = renderToStaticMarkup(createElement(AgentConnectionGuide, {
    status: { enabled: true, mcpUrl: "https://stockpilot.endpx.cloud/api/mcp" },
    error: "", retry: () => undefined,
  }));
  assert.match(html, /ChatGPT/);
  assert.match(html, /Claude/);
  assert.match(html, /Codex/);
  assert.match(html, /agent-host-mark-chatgpt/);
  assert.match(html, /agent-host-mark-claude/);
  assert.match(html, /agent-host-mark-codex/);
  assert.match(html, /mzstatic\.com\/image\/thumb/);
  assert.match(html, /images\.ctfassets\.net/);
  assert.doesNotMatch(html, /<svg[^>]*viewBox="0 0 48 48"/);
  assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 3);
  assert.match(html, /<dialog[^>]*class="agent-connect-dialog"/);
  assert.doesNotMatch(html.split("<dialog")[0], /stockpilot\.endpx\.cloud\/api\/mcp|Copy server URL/);
  assert.match(html, /stockpilot\.endpx\.cloud\/api\/mcp/);
  assert.match(html, /Copy server URL/);
  assert.match(html, /Complete OAuth/);
  assert.match(html, /ask it to list StockPilot markets/);
  assert.doesNotMatch(html, /sp_live_|New client|Create client|Issue key/);
});

test("Agent onboarding reports status failures with a retry action", () => {
  const html = renderToStaticMarkup(createElement(AgentConnectionGuide, {
    status: null, error: "temporary outage", retry: () => undefined,
  }));
  assert.match(html, /role="alert"/);
  assert.match(html, /temporary outage/);
  assert.match(html, /Try again/);
});

test("OAuth handoff shows only the verified wallet and real read-only starting scope", () => {
  const html = renderToStaticMarkup(createElement(OAuthConnectContent, {
    externalAuthId: "ext_auth_01J3X4Y5Z6A7B8C9D0E1F2G3H4",
    walletAddress: "11111111111111111111111111111111",
    handoffProof: "test-signed-proof",
  }));
  assert.match(html, /Connect an AI app/);
  assert.match(html, /11111111111111111111111111111111/);
  assert.match(html, /New agents start with market read access/);
  assert.match(html, /Existing permissions may carry over/);
  assert.doesNotMatch(html, /Starts read-only|does not grant spending access/);
  assert.match(html, /Continue with WorkOS/);
  assert.match(html, /action="\/api\/oauth\/authorize" method="post"/);
  assert.match(html, /name="handoff" value="test-signed-proof"/);
  assert.doesNotMatch(html, /Full access|Buy stocks|Sell stocks|30 days|90 days/);
});

const detailPolicy: Policy = {
  clientId: "00000000-0000-0000-0000-000000000001", approvalMode: "REQUIRED",
  scopes: ["markets:read"], buyMode: "DISABLED", sellMode: "DISABLED",
  maxInvestmentUsd: "10", dailyRequestLimitUsd: "50",
  allowedProviders: ["prestocks"], allowedMarketTypes: ["PRE_IPO"],
  version: 1, updatedAt: "2026-09-25T00:00:00.000Z",
};

test("agent detail distinguishes read-only access from an investment request grant", () => {
  const html = renderToStaticMarkup(createElement(AccessSummary, { policy: detailPolicy }));
  assert.match(html, /Read Stocks and Pre-IPO market data/);
  assert.match(html, /Investment requests are off/);
  assert.match(html, /no wallet-signing authority/);
  assert.doesNotMatch(html, /No request cap|signing key|Full access|autonomous/i);
});

test("agent detail shows request caps without implying execution authority", () => {
  const html = renderToStaticMarkup(createElement(AccessSummary, {
    policy: { ...detailPolicy, scopes: ["markets:read", "investments:request"], buyMode: "APPROVAL", maxInvestmentUsd: null },
  }));
  assert.match(html, /Requires your approval/);
  assert.match(html, /No request cap/);
  assert.match(html, /50 USDC/);
  assert.match(html, /Approval does not sign or execute a trade/);
  assert.doesNotMatch(html, /Full access|autonomous|Generate signing key/i);
});

test("revoked OAuth is not presented as an active connection when a legacy key survives", () => {
  const client: ClientRecord = {
    id: "00000000-0000-0000-0000-000000000001", name: "Codex", clientType: "CUSTOM", status: "ACTIVE",
    createdAt: "2026-09-25T00:00:00.000Z", lastUsedAt: null, expiresAt: null,
    oauthConnectedAt: "2026-09-25T00:00:00.000Z", oauthRevokedAt: "2026-09-25T01:00:00.000Z",
    authMethods: ["oauth", "api_key"], scopes: ["markets:read"],
  };
  assert.equal(agentConnectionLabel(client), "OAuth revoked · Legacy key on record");
  assert.equal(agentConnectionLabel({ ...client, status: "REVOKED", oauthRevokedAt: null }), "OAuth connection on record");
});

test("inactive agent detail labels saved policy as non-operative", () => {
  const html = renderToStaticMarkup(createElement(AccessSummary, { policy: detailPolicy, active: false }));
  assert.match(html, /saved permissions no longer grant access/);
  assert.match(html, /Saved read permissions/);
});
