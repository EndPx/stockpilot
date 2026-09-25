import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentConnectionGuide } from "../components/control-plane/clients-view";
import { OAuthConnectContent } from "../components/oauth-connect-summary";

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
