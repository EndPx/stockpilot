import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionPolicyHandlers, GET, PATCH } from "../app/api/control/clients/[id]/execution-policy/route";
import { AgentOperationError, AGENT_TRADE_ASSETS, defaultAgentWalletPolicy, parseAgentWalletPolicy,
  type AgentWalletPolicyInput } from "../lib/control-plane/agent-operations";
import { EXECUTION_POLICY_ASSETS } from "../lib/control-plane/execution-policy-format";
import { AUTH_SESSION_COOKIE } from "../lib/auth/config";
import { createAuthSession, encodeAuthSession, registerAuthSession } from "../lib/auth/session";

process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";
process.env.AUTH_ENABLED = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "execution-policy-route-test-secret-over-32-bytes";
const id = "00000000-0000-0000-0000-000000000001";
const context = { params: Promise.resolve({ id }) };
const url = `http://localhost:3000/api/control/clients/${id}/execution-policy`;
const identity = { privyUserId: "did:privy:owner", walletAddress: "11111111111111111111111111111111" };
const policy = defaultAgentWalletPolicy();
function input(): AgentWalletPolicyInput & { expectedVersion: number } {
  const { version: expectedVersion, eligibilityAcceptedAt: _accepted, updatedAt: _updated, ...fields } = policy;
  return { ...fields, expectedVersion };
}
function patch(body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function cookie() {
  const session = createAuthSession(identity.walletAddress, Date.now(), identity.privyUserId, Date.now() + 60_000);
  await registerAuthSession(session);
  return `${AUTH_SESSION_COOKIE}=${await encodeAuthSession(session, process.env.SESSION_SECRET!)}`;
}

test("execution policy endpoint requires owner login and same-origin mutation", async () => {
  assert.equal((await GET(new Request(url), context)).status, 401);
  assert.equal((await PATCH(patch(input(), { origin: "http://localhost:3000" }), context)).status, 401);
  const sessionCookie = await cookie();
  assert.equal((await PATCH(patch(input(), { cookie: sessionCookie, origin: "https://evil.example" }), context)).status, 403);
  assert.equal((await PATCH(patch(input(), { cookie: sessionCookie }), context)).status, 403);
});

test("owner read is scoped to the server identity and returns no-store defaults", async () => {
  const sessionCookie = await cookie();
  const handlers = createExecutionPolicyHandlers({ get: async (actualIdentity, actualId) => {
    assert.deepEqual(actualIdentity, identity); assert.equal(actualId, id); return policy;
  } });
  const response = await handlers.GET(new Request(`${url}?walletAddress=attacker`, {
    headers: { cookie: sessionCookie, "x-wallet-address": "attacker" },
  }), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).policy, policy);
});

test("owner mutation passes the complete policy and optimistic version without adding consent", async () => {
  const candidate = input(); let writes = 0;
  const handlers = createExecutionPolicyHandlers({ owner: async (_request, mutation) => {
    assert.equal(mutation, true); return identity;
  }, update: async (actualIdentity, actualId, value) => {
    assert.deepEqual(actualIdentity, identity); assert.equal(actualId, id); assert.deepEqual(value, candidate);
    const { expectedVersion, ...rest } = value; const parsed = parseAgentWalletPolicy(rest);
    assert.equal(expectedVersion, 0); assert.equal(parsed.automationOptIn, false); writes++;
    return { ...parsed, version: 1, eligibilityAcceptedAt: null, updatedAt: new Date().toISOString() };
  } });
  const response = await handlers.PATCH(patch(candidate), context);
  assert.equal(response.status, 200); assert.equal(writes, 1);
  assert.equal((await response.json()).policy.version, 1);
});

test("malformed, oversized and extra identity fields cannot become an execution grant", async () => {
  let writes = 0;
  const handlers = createExecutionPolicyHandlers({ owner: async () => identity, update: async (_identity, _id, value) => {
    const { expectedVersion: _version, ...rest } = value; parseAgentWalletPolicy(rest); writes++; return policy;
  } });
  assert.equal((await handlers.PATCH(patch([]), context)).status, 400);
  assert.equal((await handlers.PATCH(patch({ ...input(), walletAddress: "attacker" }), context)).status, 400);
  assert.equal((await handlers.PATCH(patch({ ...input(), automationOptIn: undefined }), context)).status, 400);
  assert.equal((await handlers.PATCH(patch({ padding: "x".repeat(20_000) }), context)).status, 413);
  assert.equal(writes, 0);
});

test("ownership and stale-version errors are safe and distinguishable", async () => {
  for (const [code, status] of [["CLIENT_NOT_ALLOWED", 403], ["POLICY_VERSION_MISMATCH", 409], ["POLICY_EXPIRED", 400]] as const) {
    const handlers = createExecutionPolicyHandlers({ owner: async () => identity, update: async () => {
      throw new AgentOperationError(code, "do not expose internal database or account details");
    } });
    const response = await handlers.PATCH(patch(input()), context);
    assert.equal(response.status, status);
    const body = await response.json(); assert.equal(body.error.code, code);
    assert.doesNotMatch(body.error.message, /internal database/);
  }
});

test("public policy asset metadata matches the server's canonical execution allowlist", () => {
  assert.deepEqual(EXECUTION_POLICY_ASSETS.map((asset) => asset.id), [...AGENT_TRADE_ASSETS]);
});
