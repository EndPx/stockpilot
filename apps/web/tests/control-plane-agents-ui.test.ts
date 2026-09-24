import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentConnectionGuide } from "../components/control-plane/clients-view";

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
  assert.match(html, /stockpilot\.endpx\.cloud\/api\/mcp/);
  assert.match(html, /Copy server URL/);
  assert.match(html, /complete OAuth/);
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
