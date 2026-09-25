import assert from "node:assert/strict";
import test from "node:test";
import { InvestmentAssetRegistry, createPreStocksProvider, createXStocksProvider, type AssetRegistryProvider, type InvestmentAsset } from "@stockpilot/core/asset-registry";
import { XStocksService } from "@stockpilot/integrations/xstocks";
import { AssetService } from "@stockpilot/core/assets";
import { normalizePreStocks } from "@stockpilot/integrations/prestocks";

const privateAssets = normalizePreStocks([{ name: "Private company", symbol: "SAME", contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" }]);
// Synthetic provider fixture, never a production allowlist or proof of issuer provenance.
const publicAsset: InvestmentAsset = {
  canonical: true, executionStatus: "UNKNOWN",
  id: "xstocks:So11111111111111111111111111111111111111112",
  mintAddress: "So11111111111111111111111111111111111111112",
  marketType: "PUBLIC_EQUITY", provider: "xstocks", name: "Public fixture", symbol: "SAME",
  description: null, imageUrl: null, tokenPriceUsd: null,
  metadata: { issuerId: "fixture", sourceUrl: "https://example.com/issuer", classificationSource: "https://example.com/equity", underlyingSymbol: "SAME", underlyingIsin: null, productIsin: null, isTradingHalted: false },
  availability: { status: "AVAILABLE", reason: null, issuerTermsUrl: "https://example.com/terms", restrictedJurisdictions: ["US"], restrictionsComplete: true, reviewedAt: "2026-09-23T00:00:00Z" },
};
function publicProvider(assets: InvestmentAsset[] = [publicAsset], stale = false): AssetRegistryProvider {
  return { provider: "xstocks", marketType: "PUBLIC_EQUITY", getSnapshot: async () => ({ assets, fetchedAt: "2026-09-23T00:00:00Z", stale }) };
}
const privateProvider = () => createPreStocksProvider(new AssetService(async () => privateAssets));

test("registry forwards stricter manual freshness to the same issuer cache used by discovery", async () => {
  let now = 0;
  let loads = 0;
  const service = new XStocksService(async () => { loads++; return [publicAsset]; }, () => now);
  const registry = new InvestmentAssetRegistry([createXStocksProvider(service)]);
  await registry.getSnapshot("xstocks");
  now = 120_000;
  assert.equal(Date.parse((await registry.getSnapshot("xstocks")).sources[0].fetchedAt), 0);
  assert.equal(loads, 1);
  const fresh = await registry.getSnapshot("xstocks", { maxAgeMs: 45_000, waitForRefresh: true });
  assert.equal(Date.parse(fresh.sources[0].fetchedAt), now);
  assert.equal(loads, 2);
  assert.equal((await registry.getSnapshot("xstocks")).sources[0].fetchedAt, fresh.sources[0].fetchedAt);
  assert.equal(loads, 2);
});

test("registry preserves PreStocks while filtering and resolving colliding tickers by ID", async () => {
  const registry = new InvestmentAssetRegistry([privateProvider(), publicProvider()]);
  assert.equal((await registry.listAssets()).length, 2);
  assert.equal((await registry.listAssets({ query: "same" })).length, 2);
  assert.deepEqual(await registry.listAssets({ marketType: "PRE_IPO" }), privateAssets);
  assert.deepEqual(await registry.listAssets({ provider: "xstocks", query: "public" }), [publicAsset]);
  assert.deepEqual(await registry.getAssetById(publicAsset.id), publicAsset);
  assert.equal(await registry.getAssetById("SAME"), null);
  assert.equal(await registry.getAssetById(publicAsset.id.toUpperCase()), null);
  assert.deepEqual(await registry.getAssetByMint(publicAsset.mintAddress), publicAsset);
});

test("arbitrary SPL mint and client-crafted ID cannot resolve in a PreStocks-only registry", async () => {
  const registry = new InvestmentAssetRegistry([privateProvider()]);
  assert.equal(await registry.getAssetByMint(publicAsset.mintAddress), null);
  assert.equal(await registry.getAssetById(publicAsset.id), null);
  assert.deepEqual(await registry.verifyAssetEligibility(publicAsset.id), { eligible: false, reason: "UNREGISTERED_ASSET" });
});

test("registry rejects forbidden pairs, mismatched IDs, invalid mints and adapter impersonation", async () => {
  for (const asset of [
    { ...publicAsset, marketType: "PRE_IPO" },
    { ...publicAsset, provider: "unknown" },
    { ...publicAsset, marketType: "ETF", metadata: undefined },
    { ...publicAsset, canonical: false },
    { ...publicAsset, executionStatus: "EXECUTABLE" },
    { ...publicAsset, id: "xstocks:SAME" },
    { ...publicAsset, id: "xstocks:invalid", mintAddress: "invalid" },
    privateAssets[0],
  ]) {
    await assert.rejects(new InvestmentAssetRegistry([publicProvider([asset as InvestmentAsset])]).listAssets());
  }
});

test("duplicates and failures fail closed rather than becoming empty/ambiguous success", async () => {
  assert.throws(() => new InvestmentAssetRegistry([publicProvider(), publicProvider()]), /Duplicate/);
  await assert.rejects(new InvestmentAssetRegistry([publicProvider([publicAsset, publicAsset])]).listAssets(), /Ambiguous/);
  const duplicateMint = { ...publicAsset, mintAddress: privateAssets[0].mintAddress, id: `xstocks:${privateAssets[0].mintAddress}` };
  await assert.rejects(new InvestmentAssetRegistry([privateProvider(), publicProvider([duplicateMint])]).listAssets(), /Ambiguous/);
  await assert.rejects(new InvestmentAssetRegistry([{ ...publicProvider(), getSnapshot: async () => { throw new Error("down"); } }]).listAssets(), /down/);
});

test("eligibility denies stale and unreviewed assets and does not equate registration with permission", async () => {
  assert.equal((await new InvestmentAssetRegistry([publicProvider()]).verifyAssetEligibility(publicAsset.id)).eligible, true);
  assert.equal((await new InvestmentAssetRegistry([publicProvider([publicAsset], true)]).verifyAssetEligibility(publicAsset.id)).reason, "STALE_REGISTRY");
  assert.equal((await new InvestmentAssetRegistry([privateProvider()]).verifyAssetEligibility(privateAssets[0].id)).eligible, false);
  for (const status of ["REVIEW_REQUIRED", "RESTRICTED", "UNAVAILABLE"] as const) {
    const asset: InvestmentAsset = { ...publicAsset, availability: { ...publicAsset.availability!, status } };
    assert.equal((await new InvestmentAssetRegistry([publicProvider([asset])]).verifyAssetEligibility(asset.id)).eligible, false);
  }
});

test("registry callers cannot mutate nested provider metadata", async () => {
  const registry = new InvestmentAssetRegistry([publicProvider()]);
  const asset = await registry.getAssetById(publicAsset.id);
  asset!.availability!.restrictedJurisdictions.push("XX");
  assert.deepEqual((await registry.getAssetById(publicAsset.id))!.availability!.restrictedJurisdictions, ["US"]);
});
