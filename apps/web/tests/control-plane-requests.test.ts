import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import { createClient } from "../lib/control-plane/clients";
import { issueCredential, verifyCredential } from "../lib/control-plane/credentials";
import { createInvestmentRequest, type AssetResolver } from "../lib/control-plane/requests";

const sql = await readFile(new URL("../migrations/0001_agent_control_plane.sql", import.meta.url), "utf8");
const identity = { privyUserId: "did:privy:alice", walletAddress: "11111111111111111111111111111111" };
const mint = "So11111111111111111111111111111111111111112";
const asset: InvestmentAsset = {
  id: `prestocks:${mint}`, name: "Example Private Company", symbol: "EXAMPLE", mintAddress: mint,
  canonical: true, executionStatus: "UNKNOWN", provider: "prestocks", marketType: "PRE_IPO",
  description: null, imageUrl: null, tokenPriceUsd: null,
};
const resolveAsset: AssetResolver = async (id) => ({ asset: id === asset.id ? asset : null, stale: false });

async function setup(scopes: ["investments:request"] | ["markets:read"] = ["investments:request"]) {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) => db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  const client = await createClient({
    identity, name: "Claude Code", clientType: "CLAUDE_CODE", scopes,
    maxInvestmentUsd: "10", dailyRequestLimitUsd: "15",
  }, store);
  const issued = await issueCredential(identity, client.id, store);
  const principal = await verifyCredential(issued.secret, store);
  assert.ok(principal);
  return { db, store, principal, client };
}

test("agent request is immutable pending intent without transaction material", async () => {
  const oldPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  process.env.CONTROL_PLANE_KEY_PEPPER = "local-test-pepper-only-at-least-32-bytes";
  let fixture: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    fixture = await setup();
    const { db, store, principal } = fixture;
    const request = await createInvestmentRequest(principal, { assetId: asset.id, amountUsd: "5.25" }, store, resolveAsset);
    assert.equal(request.status, "PENDING_APPROVAL");
    assert.equal(request.amountUsd, "5.250000");
    assert.equal(request.assetId, asset.id);
    assert.equal(request.canonicalMint, mint);
    assert.equal(request.policyVersion, 1);
    assert.equal("transaction" in request, false);
    assert.equal("signature" in request, false);
    assert.equal("walletAddress" in request, false);
    const events = await db.query<{ event_type: string }>("SELECT event_type FROM control_activity_events ORDER BY created_at");
    assert.deepEqual(events.rows.map((row) => row.event_type), ["CLIENT_CREATED", "CREDENTIAL_CREATED", "INVESTMENT_REQUESTED"]);
    await assert.rejects(db.query("UPDATE control_investment_requests SET amount_usd = 100 WHERE id = $1", [request.id]));
  } finally {
    if (fixture) await fixture.db.close();
    if (oldPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = oldPepper;
  }
});

test("per-request, daily, scope, provider, and credential gates fail closed", async () => {
  const oldPepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  process.env.CONTROL_PLANE_KEY_PEPPER = "local-test-pepper-only-at-least-32-bytes";
  let fixture: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    fixture = await setup();
    const { db, store, principal } = fixture;
    await assert.rejects(createInvestmentRequest(principal, { assetId: mint, amountUsd: "1" }, store, resolveAsset));
    await assert.rejects(createInvestmentRequest(principal, { assetId: asset.id, amountUsd: "11" }, store, resolveAsset));
    await assert.rejects(createInvestmentRequest(principal, { assetId: asset.id, amountUsd: "1" }, store,
      async () => ({ asset, stale: true })));
    await assert.rejects(createInvestmentRequest(principal, { assetId: asset.id, amountUsd: "1" }, store,
      async () => ({ asset: { ...asset, provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT" }, stale: false })));
    await createInvestmentRequest(principal, { assetId: asset.id, amountUsd: "10" }, store, resolveAsset);
    await assert.rejects(createInvestmentRequest(principal, { assetId: asset.id, amountUsd: "6" }, store, resolveAsset));
    await db.query("UPDATE control_credentials SET revoked_at = now() WHERE id = $1", [principal.credentialId]);
    await assert.rejects(createInvestmentRequest(principal, { assetId: asset.id, amountUsd: "1" }, store, resolveAsset));
    const count = await db.query<{ total: number }>("SELECT count(*)::integer AS total FROM control_investment_requests");
    assert.equal(count.rows[0].total, 1);
  } finally {
    if (fixture) await fixture.db.close();
    if (oldPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = oldPepper;
  }
  process.env.CONTROL_PLANE_KEY_PEPPER = "local-test-pepper-only-at-least-32-bytes";
  let noScope: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    noScope = await setup(["markets:read"]);
    await assert.rejects(createInvestmentRequest(noScope.principal,
      { assetId: asset.id, amountUsd: "1" }, noScope.store, resolveAsset));
  } finally {
    if (noScope) await noScope.db.close();
    if (oldPepper === undefined) delete process.env.CONTROL_PLANE_KEY_PEPPER;
    else process.env.CONTROL_PLANE_KEY_PEPPER = oldPepper;
  }
});
