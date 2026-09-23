import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import { createClient } from "../lib/control-plane/clients";
import { issueCredential, verifyCredential } from "../lib/control-plane/credentials";
import { createInvestmentRequest, getClientRequest, listClientRequests, type AssetResolver } from "../lib/control-plane/requests";
import { decideRequest, getOwnerRequest, listOwnerRequests } from "../lib/control-plane/approvals";

const sql = await readFile(new URL("../migrations/0001_agent_control_plane.sql", import.meta.url), "utf8");
const alice = { privyUserId: "did:privy:alice", walletAddress: "11111111111111111111111111111111" };
const bob = { privyUserId: "did:privy:bob", walletAddress: "22222222222222222222222222222222" };
const mint = "So11111111111111111111111111111111111111112";
const asset: InvestmentAsset = {
  id: `prestocks:${mint}`, name: "Example", symbol: "EX", mintAddress: mint, canonical: true,
  executionStatus: "UNKNOWN", provider: "prestocks", marketType: "PRE_IPO",
  description: null, imageUrl: null, tokenPriceUsd: null,
};
const resolveAsset: AssetResolver = async (id) => ({ asset: id === asset.id ? asset : null, stale: false });

test("only owner decides exact pending request; client only reads its own status", async () => {
  const previousPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  process.env.CONTROL_PLANE_KEY_PEPPER = "local-test-pepper-only-at-least-32-bytes";
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  try {
    const a = await createClient({ identity: alice, name: "Claude", clientType: "CLAUDE_CODE",
      scopes: ["investments:request", "requests:read-own"], maxInvestmentUsd: "10", dailyRequestLimitUsd: "20" }, store);
    const b = await createClient({ identity: bob, name: "Codex", clientType: "CODEX",
      scopes: ["requests:read-own"], maxInvestmentUsd: "10", dailyRequestLimitUsd: "20" }, store);
    const ap = await verifyCredential((await issueCredential(alice, a.id, store)).secret, store);
    const bp = await verifyCredential((await issueCredential(bob, b.id, store)).secret, store);
    assert.ok(ap && bp);
    const request = await createInvestmentRequest(ap, { assetId: asset.id, amountUsd: "5" }, store, resolveAsset);
    assert.equal((await getClientRequest(ap, request.id, store)).status, "PENDING_APPROVAL");
    assert.deepEqual((await listClientRequests(bp, 10, undefined, store)).requests, []);
    await assert.rejects(getClientRequest(bp, request.id, store));
    await assert.rejects(getOwnerRequest(bob, request.id, store));
    await assert.rejects(decideRequest(bob, request.id, "APPROVED", store));
    assert.equal((await listOwnerRequests(alice, "PENDING_APPROVAL", 10, store)).length, 1);
    const approved = await decideRequest(alice, request.id, "APPROVED", store);
    assert.equal(approved.status, "APPROVED");
    assert.equal((await getClientRequest(ap, request.id, store)).status, "APPROVED");
    await assert.rejects(decideRequest(alice, request.id, "REJECTED", store));
    const decisions = await db.query<{ decision: string }>("SELECT decision FROM control_approvals WHERE request_id = $1", [request.id]);
    assert.equal(decisions.rows[0].decision, "APPROVED");
    const events = await db.query<{ event_type: string }>(
      "SELECT event_type FROM control_activity_events WHERE request_id = $1 ORDER BY created_at", [request.id]);
    assert.deepEqual(events.rows.map((row) => row.event_type), ["INVESTMENT_REQUESTED", "APPROVAL_APPROVED"]);
  } finally {
    await db.close();
    if (previousPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = previousPepper;
  }
});

test("expired requests cannot be approved and log expiry once", async () => {
  const previousPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  process.env.CONTROL_PLANE_KEY_PEPPER = "local-test-pepper-only-at-least-32-bytes";
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  try {
    const client = await createClient({ identity: alice, name: "Claude", clientType: "CLAUDE_CODE",
      scopes: ["investments:request", "requests:read-own"], maxInvestmentUsd: "10", dailyRequestLimitUsd: "20" }, store);
    const principal = await verifyCredential((await issueCredential(alice, client.id, store)).secret, store);
    assert.ok(principal);
    const requestId = crypto.randomUUID();
    await db.query(
      `INSERT INTO control_investment_requests
       (id, account_id, client_id, asset_id, asset_name, asset_symbol, provider, market_type,
        canonical_mint, funding_mint, amount_usd, policy_version, policy_max_investment_usd, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'Example', 'EX', 'prestocks', 'PRE_IPO', $5, $6,
         5, 1, 10, now() - interval '20 minutes', now() - interval '5 minutes')`,
      [requestId, alice.privyUserId, client.id, asset.id, mint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    );
    await assert.rejects(decideRequest(alice, requestId, "APPROVED", store));
    const persisted = await db.query<{ status: string }>(
      "SELECT status FROM control_investment_requests WHERE id = $1", [requestId]);
    assert.equal(persisted.rows[0].status, "EXPIRED");
    assert.equal((await getOwnerRequest(alice, requestId, store)).status, "EXPIRED");
    await assert.rejects(decideRequest(alice, requestId, "REJECTED", store));
    const expired = await db.query<{ event_type: string }>(
      "SELECT event_type FROM control_activity_events WHERE request_id = $1", [requestId]);
    assert.deepEqual(expired.rows.map((row) => row.event_type), ["APPROVAL_EXPIRED"]);
  } finally {
    await db.close();
    if (previousPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = previousPepper;
  }
});
