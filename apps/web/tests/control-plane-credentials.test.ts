import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient, revokeClient } from "../lib/control-plane/clients";
import { issueCredential, revokeCredential, rotateCredential, verifyCredential } from "../lib/control-plane/credentials";

const sql = await readFile(new URL("../migrations/0001_agent_control_plane.sql", import.meta.url), "utf8");
const alice = { privyUserId: "did:privy:alice", walletAddress: "11111111111111111111111111111111" };
const bob = { privyUserId: "did:privy:bob", walletAddress: "22222222222222222222222222222222" };

async function setup() {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  return { db, store };
}

async function clientFor(identity: typeof alice, store: Awaited<ReturnType<typeof setup>>["store"]) {
  return createClient({
    identity, name: "Agent", clientType: "CUSTOM", scopes: ["markets:read", "investments:request"],
    maxInvestmentUsd: "10", dailyRequestLimitUsd: "20",
  }, store);
}

test("credential is shown once, stored only as keyed digest, and bound to its client", async () => {
  const { db, store } = await setup();
  const previousPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  process.env.CONTROL_PLANE_KEY_PEPPER = "local-test-pepper-only-at-least-32-bytes";
  try {
    const client = await clientFor(alice, store);
    await clientFor(bob, store);
    const issued = await issueCredential(alice, client.id, store);
    assert.match(issued.secret, /^sp_live_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    assert.equal(issued.displayPrefix.length, 16);
    const principal = await verifyCredential(issued.secret, store);
    assert.equal(principal?.accountId, alice.privyUserId);
    assert.equal(principal?.walletAddress, alice.walletAddress);
    assert.equal(principal?.clientId, client.id);
    assert.deepEqual(principal?.scopes, ["markets:read", "investments:request"]);
    assert.equal(await verifyCredential(`${issued.secret.slice(0, -1)}!`, store), null);
    const rows = await db.query<{ display_prefix: string; secret_hash: Uint8Array }>(
      "SELECT display_prefix, secret_hash FROM control_credentials WHERE id = $1", [issued.id]);
    assert.equal(rows.rows[0].display_prefix, issued.displayPrefix);
    assert.equal(rows.rows[0].secret_hash.length, 32);
    assert.equal(JSON.stringify(rows.rows).includes(issued.secret), false);
    const events = await db.query("SELECT details FROM control_activity_events WHERE client_id = $1", [client.id]);
    assert.equal(JSON.stringify(events.rows).includes(issued.secret), false);
    await assert.rejects(issueCredential(alice, client.id, store));
    await assert.rejects(issueCredential(bob, client.id, store));
  } finally {
    if (previousPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = previousPepper;
    await db.close();
  }
});

test("rotation, revocation, expiry and parent client revocation close access", async () => {
  const { db, store } = await setup();
  const previousPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  process.env.CONTROL_PLANE_KEY_PEPPER = "local-test-pepper-only-at-least-32-bytes";
  try {
    const client = await clientFor(alice, store);
    const first = await issueCredential(alice, client.id, store);
    const second = await rotateCredential(alice, client.id, store);
    assert.equal(await verifyCredential(first.secret, store), null);
    assert.ok(await verifyCredential(second.secret, store));
    await db.query("UPDATE control_credentials SET expires_at = now() - interval '1 second' WHERE id = $1", [second.id]);
    assert.equal(await verifyCredential(second.secret, store), null);
    await revokeCredential(alice, client.id, store);
    assert.equal(await verifyCredential(second.secret, store), null);
    const third = await issueCredential(alice, client.id, store);
    await revokeClient(alice, client.id, store);
    assert.equal(await verifyCredential(third.secret, store), null);
  } finally {
    if (previousPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = previousPepper;
    await db.close();
  }
});

test("missing credential pepper fails closed", async () => {
  const previousPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  delete process.env.CONTROL_PLANE_KEY_PEPPER;
  try {
    assert.throws(() => issueCredential(alice, crypto.randomUUID()), /not configured/);
    await assert.rejects(verifyCredential("sp_live_invalid"), /not configured/);
  } finally {
    if (previousPepper !== undefined) process.env.CONTROL_PLANE_KEY_PEPPER = previousPepper;
  }
});
