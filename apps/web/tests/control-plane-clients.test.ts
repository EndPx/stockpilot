import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient, listClients, revokeClient } from "../lib/control-plane/clients";

const sql = await readFile(new URL("../migrations/0001_agent_control_plane.sql", import.meta.url), "utf8");
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
