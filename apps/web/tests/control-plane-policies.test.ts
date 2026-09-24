import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "../lib/control-plane/clients";
import { getPolicy, updatePolicy } from "../lib/control-plane/policies";

const sql = (await Promise.all([
  "0001_agent_control_plane.sql", "0002_agent_grants_and_oauth_connections.sql",
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const alice = { privyUserId: "did:privy:alice", walletAddress: "11111111111111111111111111111111" };
const bob = { privyUserId: "did:privy:bob", walletAddress: "22222222222222222222222222222222" };

test("only account owner changes an active policy with optimistic versioning", async () => {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  try {
    const client = await createClient({
      identity: alice, name: "Codex", clientType: "CODEX", scopes: ["markets:read"],
      maxInvestmentUsd: "10", dailyRequestLimitUsd: "20",
    }, store);
    const policy = await getPolicy(alice, client.id, store);
    assert.equal(policy.approvalMode, "ALWAYS_APPROVE");
    assert.deepEqual(policy.allowedProviders, ["prestocks"]);
    assert.deepEqual(policy.allowedMarketTypes, ["PRE_IPO"]);
    await assert.rejects(getPolicy(bob, client.id, store));
    const input = { scopes: ["markets:read", "investments:request"] as ["markets:read", "investments:request"],
      maxInvestmentUsd: "25", dailyRequestLimitUsd: "50", expectedVersion: 1 };
    await assert.rejects(updatePolicy(bob, client.id, input, store));
    const updated = await updatePolicy(alice, client.id, input, store);
    assert.equal(updated.version, 2);
    assert.equal(updated.maxInvestmentUsd, "25.000000");
    await assert.rejects(updatePolicy(alice, client.id, input, store));
    assert.deepEqual((await getPolicy(alice, client.id, store)).scopes, input.scopes);
    const events = await db.query<{ event_type: string }>("SELECT event_type FROM control_activity_events ORDER BY created_at");
    assert.deepEqual(events.rows.map((row) => row.event_type), ["CLIENT_CREATED", "POLICY_UPDATED"]);
  } finally {
    await db.close();
  }
});

test("unsupported grants and invalid limits cannot be stored", async () => {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  try {
    const client = await createClient({
      identity: alice, name: "Codex", clientType: "CODEX", scopes: ["markets:read"],
      maxInvestmentUsd: "10", dailyRequestLimitUsd: "20",
    }, store);
    await assert.rejects(updatePolicy(alice, client.id, {
      scopes: ["wallet:sign"] as unknown as ["markets:read"], maxInvestmentUsd: "10", dailyRequestLimitUsd: "20", expectedVersion: 1,
    }, store));
    await assert.rejects(updatePolicy(alice, client.id, {
      scopes: ["markets:read"], maxInvestmentUsd: "100", dailyRequestLimitUsd: "20", expectedVersion: 1,
    }, store));
    await assert.rejects(db.query("UPDATE control_grant_policies SET approval_mode = 'AUTO' WHERE client_id = $1", [client.id]));
    await assert.rejects(db.query("UPDATE control_grant_policies SET allowed_providers = ARRAY['xstocks'] WHERE client_id = $1", [client.id]));
  } finally {
    await db.close();
  }
});

test("owner can explicitly remove approval-request caps, but cannot enable unimplemented trading", async () => {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  try {
    const client = await createClient({
      identity: alice, name: "Claude", clientType: "CLAUDE_CODE", scopes: ["markets:read", "investments:request"],
      maxInvestmentUsd: "10", dailyRequestLimitUsd: "50",
    }, store);
    const original = await getPolicy(alice, client.id, store);
    assert.equal(original.buyMode, "APPROVAL");
    assert.equal(original.sellMode, "DISABLED");
    assert.equal(original.maxInvestmentUsd, "10.000000");
    const unlimited = await updatePolicy(alice, client.id, {
      scopes: original.scopes, buyMode: "APPROVAL", sellMode: "DISABLED",
      maxInvestmentUsd: null, dailyRequestLimitUsd: null, expectedVersion: original.version,
    }, store);
    assert.equal(unlimited.maxInvestmentUsd, null);
    assert.equal(unlimited.dailyRequestLimitUsd, null);
    await assert.rejects(updatePolicy(alice, client.id, {
      scopes: original.scopes, buyMode: "AUTO", sellMode: "DISABLED",
      maxInvestmentUsd: null, dailyRequestLimitUsd: null, expectedVersion: unlimited.version,
    }, store), /Automatic trading/);
    await assert.rejects(updatePolicy(alice, client.id, {
      scopes: original.scopes, buyMode: "APPROVAL", sellMode: "APPROVAL",
      maxInvestmentUsd: null, dailyRequestLimitUsd: null, expectedVersion: unlimited.version,
    }, store), /Automatic trading and selling/);
    await assert.rejects(updatePolicy(alice, client.id, {
      scopes: ["markets:read"], buyMode: "APPROVAL", sellMode: "DISABLED",
      maxInvestmentUsd: null, dailyRequestLimitUsd: null, expectedVersion: unlimited.version,
    }, store), /must agree/);
    assert.equal((await getPolicy(alice, client.id, store)).version, unlimited.version);
  } finally {
    await db.close();
  }
});
