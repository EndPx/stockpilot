import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = await readFile(new URL("../migrations/0001_agent_control_plane.sql", import.meta.url), "utf8");
const grantSql = await readFile(new URL("../migrations/0002_agent_grants_and_oauth_connections.sql", import.meta.url), "utf8");

test("control-plane migration creates constrained durable tables without execution authority", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(sql);
    const tables = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'control_%' ORDER BY tablename",
    );
    assert.deepEqual(tables.rows.map((row) => row.tablename), [
      "control_accounts", "control_activity_events", "control_approvals", "control_clients",
      "control_credentials", "control_grant_policies", "control_investment_requests",
    ]);
    assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
    assert.doesNotMatch(sql, /wallet_sign|execute_transaction|private_key/i);
  } finally {
    await db.close();
  }
});

test("OAuth connections cannot cross a verified subject, account, wallet, or client binding", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`${sql}\n${grantSql}`);
    const alice = "did:privy:alice";
    const bob = "did:privy:bob";
    const aliceWallet = "11111111111111111111111111111111";
    const bobWallet = "22222222222222222222222222222222";
    const aliceClient = "00000000-0000-4000-8000-000000000011";
    const bobClient = "00000000-0000-4000-8000-000000000012";
    const issuer = "https://auth.example.test";
    await db.query("INSERT INTO control_accounts(id, primary_wallet_address) VALUES ($1, $2), ($3, $4)",
      [alice, aliceWallet, bob, bobWallet]);
    await db.query(`INSERT INTO control_clients(id, account_id, name, client_type)
      VALUES ($1, $2, 'Alice agent', 'CUSTOM'), ($3, $4, 'Bob agent', 'CUSTOM')`,
      [aliceClient, alice, bobClient, bob]);
    await assert.rejects(db.query(`INSERT INTO control_oauth_subject_bindings
      (issuer, subject, account_id, wallet_address) VALUES ($1, 'alice-sub', $2, $3)`,
      [issuer, alice, bobWallet]));
    await db.query(`INSERT INTO control_oauth_subject_bindings
      (issuer, subject, account_id, wallet_address) VALUES ($1, 'alice-sub', $2, $3)`,
      [issuer, alice, aliceWallet]);
    await assert.rejects(db.query(`INSERT INTO control_oauth_connections
      (client_id, account_id, issuer, subject, oauth_client_id)
      VALUES ($1, $2, $3, 'alice-sub', 'chatgpt')`, [bobClient, bob, issuer]));
    await assert.rejects(db.query(`INSERT INTO control_oauth_connections
      (client_id, account_id, issuer, subject, oauth_client_id)
      VALUES ($1, $2, $3, 'alice-sub', 'chatgpt')`, [aliceClient, bob, issuer]));
    await db.query(`INSERT INTO control_oauth_connections
      (client_id, account_id, issuer, subject, oauth_client_id)
      VALUES ($1, $2, $3, 'alice-sub', 'chatgpt')`, [aliceClient, alice, issuer]);
    await assert.rejects(db.query(`INSERT INTO control_oauth_connections
      (client_id, account_id, issuer, subject, oauth_client_id)
      VALUES ($1, $2, $3, 'alice-sub', 'chatgpt')`, [bobClient, alice, issuer]));
  } finally {
    await db.close();
  }
});

test("database rejects mutable request intent and non-append-only audit history", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(sql);
    const accountId = "did:privy:test";
    const wallet = "11111111111111111111111111111111";
    const clientId = "00000000-0000-4000-8000-000000000001";
    const requestId = "00000000-0000-4000-8000-000000000002";
    const eventId = "00000000-0000-4000-8000-000000000003";
    await db.query("INSERT INTO control_accounts(id, primary_wallet_address) VALUES ($1, $2)", [accountId, wallet]);
    await db.query("INSERT INTO control_clients(id, account_id, name, client_type) VALUES ($1, $2, 'Claude', 'CLAUDE_CODE')", [clientId, accountId]);
    await db.query(`INSERT INTO control_investment_requests
      (id, account_id, client_id, asset_id, asset_name, asset_symbol, provider, market_type,
       canonical_mint, funding_mint, amount_usd, policy_version, policy_max_investment_usd, expires_at)
      VALUES ($1, $2, $3, 'prestocks:mint', 'SpaceX', 'SPACEX', 'prestocks', 'PRE_IPO',
              'mint', 'usdc', 50, 1, 100, now() + interval '15 minutes')`, [requestId, accountId, clientId]);
    await assert.rejects(db.query("UPDATE control_investment_requests SET amount_usd = 100 WHERE id = $1", [requestId]));
    await db.query("UPDATE control_investment_requests SET status = 'APPROVED', decided_at = now() WHERE id = $1", [requestId]);
    await assert.rejects(db.query("UPDATE control_investment_requests SET status = 'REJECTED' WHERE id = $1", [requestId]));
    await db.query("INSERT INTO control_activity_events(id, account_id, client_id, request_id, event_type, actor_type) VALUES ($1, $2, $3, $4, 'INVESTMENT_REQUESTED', 'CLIENT')", [eventId, accountId, clientId, requestId]);
    await assert.rejects(db.query("DELETE FROM control_activity_events WHERE id = $1", [eventId]));
    await db.query("INSERT INTO control_accounts(id, primary_wallet_address) VALUES ('did:privy:other', $1)", [wallet]);
    await assert.rejects(db.query("INSERT INTO control_approvals(request_id, account_id, decision) VALUES ($1, 'did:privy:other', 'APPROVED')", [requestId]));
    await assert.rejects(db.query("INSERT INTO control_activity_events(id, account_id, client_id, event_type, actor_type) VALUES ('00000000-0000-4000-8000-000000000004', 'did:privy:other', $1, 'CLIENT_CREATED', 'USER')", [clientId]));
  } finally {
    await db.close();
  }
});
