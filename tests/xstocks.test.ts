import assert from "node:assert/strict";
import test from "node:test";
import { fetchXStocks, fetchXStocksCatalog, normalizeXStock, XStocksService } from "@stockpilot/integrations/xstocks";
const mint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const row = { id: "issuer-1", name: "Apple xStock", symbol: "AAPLx", deployments: [{ network: "Solana", address: mint }], underlying: { type: null } };
const page = (nodes: unknown[], currentPage = 0, hasNextPage = false) => ({ nodes, page: { currentPage, hasNextPage } });
function fetchPages(pages: unknown[]) {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (url) => { urls.push(String(url)); return Response.json(pages[urls.length - 1]); };
  return { urls, fetcher };
}
test("full issuer pagination admits generic canonical products, never ready-to-trade", async () => {
  const second = { ...row, id: "issuer-2", deployments: [{ network: "Solana", address: "So11111111111111111111111111111111111111112" }] };
  const { urls, fetcher } = fetchPages([page([row], 0, true), page([second], 1)]);
  const assets = await fetchXStocks(fetcher);
  assert.equal(assets.length, 2); assert.match(urls[1], /page=1$/);
  assert.equal(assets[0].id, `xstocks:${mint}`);
  assert.equal(assets[0].marketType, "PUBLIC_MARKET_PRODUCT");
  assert.equal(assets[0].canonical, true); assert.equal(assets[0].executionStatus, "UNKNOWN");
  assert.equal(normalizeXStock({ ...row, symbol: "RENAMED" }).id, assets[0].id);
});
test("classification uses explicit issuer type, not a ticker heuristic", () => {
  assert.equal(normalizeXStock({ ...row, underlying: { type: "ETF" } }).marketType, "ETF");
  assert.equal(normalizeXStock({ ...row, underlying: { type: "Equity" } }).marketType, "PUBLIC_EQUITY");
  assert.throws(() => normalizeXStock({ ...row, underlying: { type: "PRE_IPO" } }));
});
test("representative classification binds mint, issuer identity and underlying, never ticker alone", () => {
  const apple = { ...row, id: "9e43a778-fdc8-44f1-87de-f2e7420bb7f7", isin: "CH1436219187", underlying: { type: null, isin: "US0378331005" } };
  assert.equal(normalizeXStock(apple).marketType, "PUBLIC_EQUITY");
  assert.equal(normalizeXStock({ ...apple, underlying: { type: null, isin: "changed" } }).marketType, "PUBLIC_MARKET_PRODUCT");
  assert.equal(normalizeXStock({ ...apple, deployments: [{ network: "Solana", address: "So11111111111111111111111111111111111111112" }] }).marketType, "PUBLIC_MARKET_PRODUCT");
  assert.throws(() => normalizeXStock({ ...apple, underlying: { type: "ETF", isin: "US0378331005" } }));
});
test("rejects duplicate identity, malformed pagination, missing or ambiguous deployments", async () => {
  for (const payload of [page([row, row]), page([{ ...row, deployments: [] }]), page([{ ...row, deployments: [...row.deployments, ...row.deployments] }]), page([{ ...row, deployments: [{ network: "Solana", address: "fake" }] }]), page([row], 1), page([], 0, true), page([])]) {
    await assert.rejects(fetchXStocks(fetchPages([payload]).fetcher));
  }
  await assert.rejects(fetchXStocks(fetchPages([page([row], 0, true), page([row], 1)]).fetcher));
});
test("bounded cache shares refresh, clones records and cannot extend stale lifetime", async () => {
  let now = 0; let calls = 0; let fail = false;
  const service = new XStocksService(async () => { calls++; if (fail) throw new Error("down"); return [normalizeXStock(row)]; }, () => now);
  const [a] = await Promise.all([service.getSnapshot(), service.getSnapshot()]);
  assert.equal(calls, 1); a.assets[0].metadata!.issuerId = "mutated";
  assert.equal((await service.getSnapshot()).assets[0].metadata!.issuerId, "issuer-1");
  now = 300_001; fail = true; assert.equal((await service.getSnapshot()).stale, true);
  now = 1_800_000; await assert.rejects(service.getSnapshot());
});

test("issuer-verified private exposure is excluded without hiding the rest of the catalog", async () => {
  const privateFund = { ...row, id: "3b5de927-b421-48ec-81b1-74c8eec4925f", symbol: "RENAMED", deployments: [{ network: "Solana", address: "Xs7UsqobM3EJgMeHwdAbmDBCZH1G5WTCjatpeYcCr8x" }] };
  const catalog = await fetchXStocksCatalog(fetchPages([page([row, privateFund])]).fetcher);
  assert.equal(catalog.canonicalCount, 2); assert.equal(catalog.assets.length, 1);
  assert.equal(catalog.excluded[0].reason, "PRIVATE_EXPOSURE_REQUIRES_PRESTOCKS");
  assert.equal(catalog.assets[0].id, `xstocks:${mint}`);
});
