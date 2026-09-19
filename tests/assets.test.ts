import assert from "node:assert/strict";
import test from "node:test";
import { AssetService, type Asset } from "@stockpilot/core/assets";
import { normalizePreStocks } from "@stockpilot/integrations/prestocks";

const assets = normalizePreStocks([
  { name: "SpaceX PreStocks", symbol: "SPACEX", description: "Space launch systems", contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" },
  { name: "Anthropic PreStocks", symbol: "ANTHROPIC", contract_address: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
]);

test("lists and searches live registry fields case-insensitively", async () => {
  const service = new AssetService(async () => assets);
  assert.deepEqual(await service.listAssets(), assets);
  for (const query of [" spacex ", "SPACE LAUNCH", "SpaceX PreStocks"]) {
    assert.deepEqual(await service.listAssets(query), [assets[0]]);
  }
  assert.deepEqual(await service.listAssets("absent"), []);
  assert.deepEqual(await new AssetService(async () => []).listAssets(), []);
});

test("symbol lookup is exact ignoring case; mint lookup is exact including case", async () => {
  const service = new AssetService(async () => assets);
  for (const symbol of ["spacex", "SpaceX", "SPACEX"]) assert.deepEqual(await service.getAssetBySymbol(symbol), assets[0]);
  assert.equal(await service.getAssetBySymbol("space"), null);
  assert.deepEqual(await service.getAssetByMint(assets[0].mintAddress), assets[0]);
  assert.equal(await service.getAssetByMint(assets[0].mintAddress.toLowerCase()), null);
  assert.equal(await service.getAssetByMint("invalid"), null);
});

test("fresh cache lasts 45 seconds and returned data cannot mutate it", async () => {
  let now = 0;
  let calls = 0;
  const service = new AssetService(async () => { calls++; return assets; }, () => now);
  const first = await service.listAssets();
  first[0].name = "Changed";
  now = 44_999;
  assert.equal((await service.listAssets())[0].name, assets[0].name);
  assert.equal(calls, 1);
  now = 45_000;
  await service.listAssets();
  assert.equal(calls, 2);
});

test("concurrent cold requests share one provider fetch", async () => {
  let calls = 0;
  let resolve!: (assets: Asset[]) => void;
  const waiting = new Promise<Asset[]>((done) => { resolve = done; });
  const service = new AssetService(() => { calls++; return waiting; });
  const requests = [service.listAssets(), service.getAssetBySymbol("SPACEX"), service.getSnapshot()];
  resolve(assets);
  await Promise.all(requests);
  assert.equal(calls, 1);
});

test("stale fallback is marked and expires five minutes after last success", async () => {
  let now = 0;
  let fails = false;
  const service = new AssetService(async () => { if (fails) throw new Error("Provider down"); return assets; }, () => now);
  const initial = await service.getSnapshot();
  fails = true;
  now = 45_000;
  const stale = await service.getSnapshot();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, initial.fetchedAt);
  now = 299_999;
  assert.equal((await service.getSnapshot()).stale, true);
  now = 300_000;
  await assert.rejects(service.getSnapshot(), /Provider down/);
  fails = false;
  assert.equal((await service.getSnapshot()).stale, false);
});

test("a cold provider failure is an error, not an empty registry", async () => {
  const service = new AssetService(async () => { throw new Error("Malformed response"); });
  await assert.rejects(service.listAssets(), /Malformed response/);
});
