import assert from "node:assert/strict";
import test from "node:test";
import { InvestmentAssetRegistry, createPreStocksProvider } from "@stockpilot/core/asset-registry";
import { AssetService } from "@stockpilot/core/assets";
import { normalizePreStocks } from "@stockpilot/integrations/prestocks";
import { normalizeXStock } from "@stockpilot/integrations/xstocks";
const mints = ["XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"];
const publicAssets = mints.map((mint, i) => normalizeXStock({ id: String(i), name: `Company ${i}`, symbol: "COLLISION", underlying: { type: i === 1 ? "ETF" : null, symbol: `UNDERLYING${i}` }, deployments: [{ network: "Solana", address: mint }] }));
const privateAssets = normalizePreStocks([{ name: "Private Company", symbol: "COLLISION", contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" }]);
const privateProvider = createPreStocksProvider(new AssetService(async () => privateAssets));
const publicProvider = { provider: "xstocks" as const, marketType: "PUBLIC_MARKET_PRODUCT" as const, getSnapshot: async () => ({ assets: publicAssets, fetchedAt: new Date().toISOString(), stale: false }) };
const registry = new InvestmentAssetRegistry([privateProvider, publicProvider]);
test("bounded keyset pages preserve colliding tickers and include entire universe exactly once", async () => {
  const seen: string[] = []; let cursor: string | undefined;
  do {
    const page = await registry.listPage({ query: "collision", limit: 2, cursor });
    assert.equal(page.total, 4); assert.ok(page.assets.length <= 2);
    seen.push(...page.assets.map(({ id }) => id)); cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(seen.length, 4); assert.equal(new Set(seen).size, 4);
});
test("deterministic search, group, provider and evidenced market filters", async () => {
  assert.equal((await registry.listPage({ group: "private" })).total, 1);
  assert.equal((await registry.listPage({ group: "public" })).total, 3);
  assert.equal((await registry.listPage({ provider: "xstocks", query: "underlying2" })).total, 1);
  assert.equal((await registry.listPage({ marketType: "ETF" })).total, 1);
  assert.equal((await registry.listPage({ query: "not found" })).total, 0);
});
test("malformed/mismatched cursors and unbounded requests fail before listing", async () => {
  const cursor = (await registry.listPage({ limit: 1 })).nextCursor!;
  for (const filter of [{ cursor: "garbage" }, { cursor, query: "different" }, { limit: 1000 }, { limit: 0 }, { query: "x".repeat(101) }, { group: "private" as const, provider: "xstocks" as const }]) await assert.rejects(registry.listPage(filter));
});
test("PreStocks discovery remains accessible if the public issuer fails", async () => {
  const partial = new InvestmentAssetRegistry([privateProvider, { ...publicProvider, getSnapshot: async () => { throw new Error("down"); } }]);
  await assert.rejects(partial.listPage());
  assert.equal((await partial.listPage({ group: "private" })).total, 1);
});
