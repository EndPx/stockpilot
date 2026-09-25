import assert from "node:assert/strict";
import test from "node:test";
import { MemoryAuthSecurityStore } from "../lib/auth/store";
import { createMcpPost } from "../app/api/mcp/route";

process.env.APP_URL = "https://stockpilot.endpx.cloud";
process.env.SESSION_SECRET = "mcp-route-test-secret-at-least-32-bytes";

const secret = `sp_live_${"a".repeat(32)}_${"B".repeat(43)}`;

function request(options: { authorization?: string; origin?: string; host?: string; body?: object; url?: string } = {}) {
  return new Request(options.url ?? "https://stockpilot.endpx.cloud/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25", host: options.host ?? "stockpilot.endpx.cloud",
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
    body: JSON.stringify(options.body ?? { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

test("MCP bearer authentication and host/origin checks run before SDK dispatch", async () => {
  const securityStore = new MemoryAuthSecurityStore();
  let verified = 0;
  const post = createMcpPost({ securityStore, verify: async () => {
    verified++;
    return { authMethod: "api_key", accountId: "did:privy:alice", walletAddress: "11111111111111111111111111111111",
      clientId: "183fc984-91ea-4c08-9870-d62f3da31614",
      credentialId: "c9780dca-f3a3-4212-9232-3c32fab8e33d", scopes: ["markets:read"] };
  } });
  assert.equal((await post(request())).status, 401);
  assert.equal((await post(request({ authorization: "Bearer invalid" }))).status, 401);
  assert.equal((await post(request({ authorization: `Bearer ${secret}`, host: "evil.example" }))).status, 403);
  assert.equal((await post(request({ authorization: `Bearer ${secret}`, origin: "https://evil.example" }))).status, 403);
  assert.equal((await post(request({ authorization: `Bearer ${secret}`, url: "https://stockpilot.endpx.cloud/api/mcp?key=leak" }))).status, 400);
  assert.equal(verified, 0);
  const response = await post(request({ authorization: `Bearer ${secret}` }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(verified, 1);
  const raw = await response.text();
  assert.equal(raw.includes(secret), false);
  assert.match(raw, /list_stocks/);
  assert.match(raw, /list_pre_ipo/);
  assert.doesNotMatch(raw, /list_assets|get_asset/);
});
