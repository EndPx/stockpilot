import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "../lib/control-plane/clients";
import { getActivityWeek, listActivity } from "../lib/control-plane/activity";

const sql = (await Promise.all([
  "0001_agent_control_plane.sql", "0002_agent_grants_and_oauth_connections.sql",
  "0003_idempotent_investment_requests.sql",
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const alice = { privyUserId: "did:privy:alice", walletAddress: "11111111111111111111111111111111" };
const bob = { privyUserId: "did:privy:bob", walletAddress: "22222222222222222222222222222222" };

test("activity is durable, owner-scoped, bounded and append-only", async () => {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  try {
    const aliceClient = await createClient({ identity: alice, name: "Alice Agent", clientType: "CUSTOM", scopes: ["markets:read"],
      maxInvestmentUsd: "10", dailyRequestLimitUsd: "20" }, store);
    const aliceOther = await createClient({ identity: alice, name: "Alice Other", clientType: "CUSTOM", scopes: ["markets:read"],
      maxInvestmentUsd: "10", dailyRequestLimitUsd: "20" }, store);
    const bobClient = await createClient({ identity: bob, name: "Bob Agent", clientType: "CUSTOM", scopes: ["markets:read"],
      maxInvestmentUsd: "10", dailyRequestLimitUsd: "20" }, store);
    await db.query(`INSERT INTO control_activity_events(id, account_id, client_id, event_type, actor_type)
      VALUES ($1, $2, $3, 'APPROVAL_REJECTED', 'USER')`,
    ["00000000-0000-0000-0000-000000000099", alice.privyUserId, aliceClient.id]);
    const activity = await listActivity(alice, 10, store);
    assert.equal(activity.length, 3);
    assert.deepEqual(activity.filter((event) => event.eventType === "CLIENT_CREATED").map((event) => event.clientId).sort(), [aliceClient.id, aliceOther.id].sort());
    assert.equal(activity[0].eventType, "APPROVAL_REJECTED");
    const week = await getActivityWeek(alice, store);
    assert.equal(week.length, 7);
    assert.equal(week.at(-1)?.date, new Date().toISOString().slice(0, 10));
    assert.deepEqual(week.at(-1), { date: new Date().toISOString().slice(0, 10), activityCount: 2, approvalCount: 1 });
    assert.deepEqual((await getActivityWeek(bob, store)).at(-1), {
      date: new Date().toISOString().slice(0, 10), activityCount: 1, approvalCount: 0,
    });
    assert.deepEqual((await listActivity(bob, 10, store)).map((event) => event.clientName), ["Bob Agent"]);
    const clientActivity = await listActivity(alice, 10, store, aliceClient.id);
    assert.deepEqual(clientActivity.map((event) => event.clientId), [aliceClient.id, aliceClient.id]);
    assert.deepEqual((await listActivity(alice, 10, store, aliceOther.id)).map((event) => event.clientId), [aliceOther.id]);
    await assert.rejects(listActivity(alice, 10, store, bobClient.id),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "CLIENT_NOT_FOUND");
    await assert.rejects(listActivity(alice, 10, store, "invalid"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "CLIENT_NOT_FOUND");
    await assert.rejects(listActivity({ ...alice, walletAddress: bob.walletAddress }, 10, store));
    await assert.rejects(getActivityWeek({ ...alice, walletAddress: bob.walletAddress }, store));
    await assert.rejects(listActivity(alice, 101, store));
    await assert.rejects(db.query("DELETE FROM control_activity_events WHERE id = $1", [activity[0].id]));
    await assert.rejects(db.query("UPDATE control_activity_events SET actor_type = 'SYSTEM' WHERE id = $1", [activity[0].id]));
  } finally {
    await db.close();
  }
});
