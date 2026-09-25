import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthAuthorizeGet, createOAuthAuthorizePost } from "../app/api/oauth/authorize/route";
import { createMcpPost } from "../app/api/mcp/route";
import { getAuthRuntimeConfig } from "../lib/auth/config";
import { safeReturnPath } from "../lib/auth/page-paths";
import { createAuthSession, encodeAuthSession, registerAuthSession } from "../lib/auth/session";
import { MemoryAuthSecurityStore } from "../lib/auth/store";
import { createOAuthHandoffProof, verifyOAuthHandoffProof } from "../lib/control-plane/oauth-handoff";

const settings = {
  AGENT_OAUTH_ENABLED: "true", NEXT_PUBLIC_AUTH_PROVIDER: "privy", PRIVY_APP_SECRET: "test-privy-secret",
  CONTROL_PLANE_DATABASE_URL: "postgres://unused", WORKOS_AUTHKIT_ISSUER: "https://stockpilot-test.authkit.app",
  WORKOS_API_KEY: "sk_test_only_not_a_real_key", APP_URL: "https://stockpilot.endpx.cloud",
  SESSION_SECRET: "oauth-route-test-session-secret-longer-than-32-bytes", AUTH_ENABLED: "true",
};
const externalAuthId = "ext_auth_01J3X4Y5Z6A7B8C9D0E1F2G3H4";
const wallet = "11111111111111111111111111111111";

async function withOAuthEnvironment(work: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  try { await work(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function loginRequest(cookie?: string, query = `?external_auth_id=${externalAuthId}`) {
  return new Request(`https://stockpilot.endpx.cloud/api/oauth/authorize${query}`, {
    headers: { host: "stockpilot.endpx.cloud", ...(cookie ? { cookie: `stockpilot-session=${encodeURIComponent(cookie)}` } : {}) },
  });
}

function connectRequest(cookie?: string, body = "", origin = settings.APP_URL) {
  return new Request(`${settings.APP_URL}/api/oauth/authorize`, {
    method: "POST", headers: { host: "stockpilot.endpx.cloud", origin,
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie: `stockpilot-session=${encodeURIComponent(cookie)}` } : {}) }, body,
  });
}

test("Standalone login URI shows a StockPilot handoff before WorkOS consent and binds only on same-origin owner submit", async () => {
  await withOAuthEnvironment(async () => {
    const store = new MemoryAuthSecurityStore();
    let completed = 0;
    let bound = 0;
    const dependencies = {
      securityStore: store,
      readIdentity: async () => ({ email: "alice@example.com" }),
      complete: async (id, privyUserId, email) => {
        assert.equal(id, externalAuthId);
        assert.equal(privyUserId, "did:privy:alice");
        assert.equal(email, "alice@example.com");
        completed++;
        return new URL("https://stockpilot-test.authkit.app/oauth/authorize/complete?state=opaque");
      },
      readUser: async () => ({ id: "user_01JQ0E27VT3MH79RY0FVA4QBP9", externalId: "did:privy:alice" }),
      bind: async (identity) => {
        assert.equal(identity.walletAddress, wallet);
        assert.equal(identity.privyUserId, "did:privy:alice");
        bound++;
      },
    } satisfies NonNullable<Parameters<typeof createOAuthAuthorizePost>[0]>;
    const get = createOAuthAuthorizeGet(dependencies);
    const post = createOAuthAuthorizePost(dependencies);
    const guest = await get(loginRequest());
    assert.equal(guest.status, 303);
    const signIn = new URL(guest.headers.get("location")!);
    assert.equal(signIn.pathname, "/sign-in");
    assert.equal(signIn.searchParams.get("next"), `/api/oauth/authorize?external_auth_id=${externalAuthId}`);
    assert.equal(safeReturnPath(signIn.searchParams.get("next")), `/api/oauth/authorize?external_auth_id=${externalAuthId}`);
    assert.equal(safeReturnPath(`/connect?external_auth_id=${externalAuthId}`), `/connect?external_auth_id=${externalAuthId}`);
    assert.equal(safeReturnPath("/connect?external_auth_id=bad"), "/app");
    assert.equal(safeReturnPath("/api/oauth/authorize?external_auth_id=bad"), "/app");
    assert.equal(completed, 0);

    const invalid = await get(loginRequest(undefined, "?external_auth_id=bad"));
    assert.equal(invalid.status, 400);
    const auth = getAuthRuntimeConfig();
    const session = createAuthSession(wallet, Date.now(), "did:privy:alice", Date.now() + 10 * 60_000);
    await registerAuthSession(session, auth, store);
    const token = await encodeAuthSession(session, auth.sessionSecret);
    const handoff = await get(loginRequest(token));
    assert.equal(handoff.status, 303);
    assert.equal(handoff.headers.get("location"), `${settings.APP_URL}/connect?external_auth_id=${externalAuthId}`);
    assert.equal(handoff.headers.get("referrer-policy"), "no-referrer");
    assert.equal(completed, 0);
    assert.equal(bound, 0);
    const proof = await createOAuthHandoffProof(externalAuthId, session, auth.sessionSecret);
    const form = new URLSearchParams({ external_auth_id: externalAuthId, handoff: proof }).toString();

    assert.equal((await post(connectRequest(token, form, "https://untrusted.example"))).status, 403);
    assert.equal((await post(connectRequest(token, `${form}&scope=write`))).status, 400);
    assert.equal((await post(connectRequest(token, "x".repeat(2_049)))).status, 400);
    assert.equal((await post(connectRequest(token, new URLSearchParams({ external_auth_id: externalAuthId }).toString()))).status, 400);
    const tamperedProof = `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}`;
    const tampered = new URLSearchParams({ external_auth_id: externalAuthId, handoff: tamperedProof }).toString();
    const tamperedResponse = await post(connectRequest(token, tampered));
    assert.equal(tamperedResponse.status, 303);
    assert.equal(new URL(tamperedResponse.headers.get("location")!).pathname, "/connect");
    assert.equal(await verifyOAuthHandoffProof(proof, `${externalAuthId}x`, session, auth.sessionSecret), false);
    const switchedSession = createAuthSession(wallet, Date.now(), "did:privy:alice", Date.now() + 10 * 60_000);
    await registerAuthSession(switchedSession, auth, store);
    const switchedToken = await encodeAuthSession(switchedSession, auth.sessionSecret);
    assert.equal(new URL((await post(connectRequest(switchedToken, form))).headers.get("location")!).pathname, "/connect");
    assert.equal(await verifyOAuthHandoffProof(proof, externalAuthId, session, auth.sessionSecret, Date.now() + 6 * 60_000), false);
    assert.equal(completed, 0);
    const signedOut = await post(connectRequest(undefined, form));
    assert.equal(new URL(signedOut.headers.get("location")!).pathname, "/sign-in");
    assert.equal(completed, 0);

    const success = await post(connectRequest(token, form));
    assert.equal(success.status, 303);
    assert.equal(success.headers.get("location"), "https://stockpilot-test.authkit.app/oauth/authorize/complete?state=opaque");
    assert.equal(success.headers.get("referrer-policy"), "no-referrer");
    assert.equal(completed, 1);
    assert.equal(bound, 1);
  });
});

test("MCP advertises OAuth discovery and accepts only a verified OAuth principal", async () => {
  await withOAuthEnvironment(async () => {
    const store = new MemoryAuthSecurityStore();
    let verified = 0;
    const post = createMcpPost({ securityStore: store, verifyOAuth: async () => {
      verified++;
      return { authMethod: "oauth", credentialId: null, accountId: "did:privy:alice", walletAddress: wallet,
        clientId: "183fc984-91ea-4c08-9870-d62f3da31614", oauthIssuer: settings.WORKOS_AUTHKIT_ISSUER,
        oauthSubject: "user_01JQ0E27VT3MH79RY0FVA4QBP9", oauthClientId: "client_01JP8BD0CZ401TDF9X54NT5ZEK",
        scopes: ["markets:read"] };
    } });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const baseHeaders = { host: "stockpilot.endpx.cloud", "content-type": "application/json",
      accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" };
    const denied = await post(new Request("https://stockpilot.endpx.cloud/api/mcp", {
      method: "POST", headers: baseHeaders, body,
    }));
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/stockpilot\.endpx\.cloud\/\.well-known\/oauth-protected-resource"/);
    const accepted = await post(new Request("https://stockpilot.endpx.cloud/api/mcp", {
      method: "POST", headers: { ...baseHeaders, authorization: "Bearer aaa.bbb.ccc" }, body,
    }));
    assert.equal(accepted.status, 200);
    assert.equal(verified, 1);
  });
});
