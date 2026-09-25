import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient, getClient, listClients, revokeClient } from "../lib/control-plane/clients";
import { issueCredential } from "../lib/control-plane/credentials";
import { bindOAuthSubject, resolveOAuthPrincipal } from "../lib/control-plane/oauth-binding";

const sql = (await Promise.all([
  "0001_agent_control_plane.sql", "0002_agent_grants_and_oauth_connections.sql",
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const walletA = "11111111111111111111111111111111";
const walletB = "22222222222222222222222222222222";

async function setup() {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  return { db, store };
}

test("clients and policies belong only to the verified Privy account", async () => {
  const { db, store } = await setup();
  try {
    const identityA = { privyUserId: "did:privy:alice", walletAddress: walletA };
    const identityB = { privyUserId: "did:privy:bob", walletAddress: walletB };
    const a = await createClient({
      identity: identityA, name: " Claude Code ", clientType: "CLAUDE_CODE",
      scopes: ["markets:read", "portfolio:read", "investments:request"],
      maxInvestmentUsd: "100", dailyRequestLimitUsd: "300",
    }, store);
    const b = await createClient({
      identity: identityB, name: "Codex", clientType: "CODEX",
      scopes: ["markets:read"], maxInvestmentUsd: "10", dailyRequestLimitUsd: "20",
    }, store);
    assert.equal(a.name, "Claude Code");
    assert.deepEqual((await listClients(identityA, store)).map((item) => item.id), [a.id]);
    assert.deepEqual((await listClients(identityB, store)).map((item) => item.id), [b.id]);
    await assert.rejects(listClients({ privyUserId: identityA.privyUserId, walletAddress: walletB }, store),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "WALLET_BINDING_MISMATCH");
    await assert.rejects(revokeClient(identityB, a.id, store),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "CLIENT_NOT_FOUND");
    await revokeClient(identityA, a.id, store);
    assert.equal((await listClients(identityA, store))[0].status, "REVOKED");
    const events = await db.query<{ event_type: string }>("SELECT event_type FROM control_activity_events WHERE account_id = $1 ORDER BY created_at", [identityA.privyUserId]);
    assert.deepEqual(events.rows.map((row) => row.event_type), ["CLIENT_CREATED", "CLIENT_REVOKED"]);
  } finally {
    await db.close();
  }
});

test("unsupported grants and malformed limits fail before account creation", async () => {
  const { db, store } = await setup();
  try {
    const identity = { privyUserId: "did:privy:alice", walletAddress: walletA };
    for (const scopes of [["wallet:sign"], ["markets:read", "markets:read"]]) {
      await assert.rejects(createClient({
        identity, name: "Agent", clientType: "CUSTOM", scopes: scopes as ["markets:read"],
        maxInvestmentUsd: "10", dailyRequestLimitUsd: "20",
      }, store), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_CLIENT");
    }
    await assert.rejects(createClient({
      identity, name: "Agent", clientType: "CUSTOM", scopes: ["markets:read"],
      maxInvestmentUsd: "100", dailyRequestLimitUsd: "20",
    }, store));
    const accounts = await db.query("SELECT id FROM control_accounts");
    assert.equal(accounts.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("agent detail reports verified OAuth and key methods, effective status, and no secret identity", async () => {
  const { db, store } = await setup();
  const identity = { privyUserId: "did:privy:alice", walletAddress: walletA };
  const oauth = { issuer: "https://stockpilot-test.authkit.app", resource: "https://stockpilot.test/api/mcp",
    appOrigin: "https://stockpilot.test", apiKey: "sk_test_only_not_a_real_key" };
  const subject = "user_01JQ0E27VT3MH79RY0FVA4QBP9";
  const oauthClientId = "https://chatgpt.com/oauth/codex/example/client.json";
  const previousPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  process.env.CONTROL_PLANE_KEY_PEPPER = "agent-detail-test-pepper-longer-than-32-bytes";
  try {
    await bindOAuthSubject({ ...identity, workosUserId: subject }, oauth, store);
    const principal = await resolveOAuthPrincipal({ subject, clientId: oauthClientId }, identity.privyUserId, oauth, store);
    assert.ok(principal);
    const connected = await getClient(identity, principal.clientId, store);
    assert.equal(connected.name, "Codex");
    assert.equal(connected.status, "ACTIVE");
    assert.deepEqual(connected.authMethods, ["oauth"]);
    assert.equal(connected.expiresAt, null);
    assert.ok(connected.oauthConnectedAt);
    assert.equal(connected.oauthRevokedAt, null);
    assert.deepEqual(connected.scopes, ["markets:read"]);
    assert.doesNotMatch(JSON.stringify(connected), /user_01JQ0E27|chatgpt\.com\/oauth\/codex/);
    const listed = (await listClients(identity, store)).find((client) => client.id === principal.clientId);
    assert.ok(listed);
    assert.deepEqual(listed.authMethods, ["oauth"]);
    assert.equal(listed.oauthConnectedAt, connected.oauthConnectedAt);
    assert.equal(listed.expiresAt, null);
    assert.equal(listed.status, "ACTIVE");

    await assert.rejects(getClient({ privyUserId: "did:privy:bob", walletAddress: walletB }, principal.clientId, store),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "CLIENT_NOT_FOUND");
    await assert.rejects(getClient({ ...identity, walletAddress: walletB }, principal.clientId, store),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "CLIENT_NOT_FOUND");
    await assert.rejects(getClient(identity, "not-a-uuid", store),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "CLIENT_NOT_FOUND");

    await db.query("UPDATE control_clients SET expires_at = now() - interval '1 second' WHERE id = $1", [principal.clientId]);
    assert.equal((await getClient(identity, principal.clientId, store)).status, "EXPIRED");
    assert.equal((await listClients(identity, store))[0].status, "EXPIRED");
    await db.query("UPDATE control_clients SET expires_at = NULL WHERE id = $1", [principal.clientId]);
    await db.query("UPDATE control_oauth_connections SET revoked_at = now() WHERE client_id = $1", [principal.clientId]);
    assert.equal((await getClient(identity, principal.clientId, store)).status, "REVOKED");

    await issueCredential(identity, principal.clientId, store);
    const withKey = await getClient(identity, principal.clientId, store);
    assert.equal(withKey.status, "ACTIVE");
    assert.deepEqual(withKey.authMethods, ["oauth", "api_key"]);
    assert.ok(withKey.oauthRevokedAt);
  } finally {
    if (previousPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = previousPepper;
    await db.close();
  }
});
