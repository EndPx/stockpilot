import assert from "node:assert/strict";
import test from "node:test";
import { fetchXStocks, fetchXStocksCatalog, normalizeXStock, XStocksProviderError, XStocksService } from "@stockpilot/integrations/xstocks";
import { MAX_PROVIDER_JSON_BYTES } from "../packages/integrations/src/provider-json.js";
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
test("bounded issuer lookahead reduces cold loading without admitting pages after the terminal page", async () => {
  const urls: string[] = [];
  let release!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const second = { ...row, id: "issuer-2", deployments: [{ network: "Solana", address: "So11111111111111111111111111111111111111112" }] };
  const third = { ...row, id: "issuer-3", deployments: [{ network: "Solana", address: "11111111111111111111111111111111" }] };
  const fetcher: typeof fetch = async (url) => {
    const current = Number(new URL(String(url)).searchParams.get("page"));
    urls.push(String(url));
    if (current === 0) return Response.json(page([row], 0, true));
    if (current === 1) return held;
    if (current === 2) return Response.json(page([third], 2, false));
    throw new Error("Speculative page outside the catalog");
  };
  const loading = fetchXStocks(fetcher);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(urls.map((url) => Number(new URL(url).searchParams.get("page"))), [0, 1, 2, 3]);
  release(Response.json(page([second], 1, true)));
  assert.equal((await loading).length, 3);
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

test("public catalog serves a bounded cached snapshot while paginated refresh is pending", async () => {
  let now = 0;
  let calls = 0;
  let finish!: (assets: ReturnType<typeof normalizeXStock>[]) => void;
  const refresh = new Promise<ReturnType<typeof normalizeXStock>[]>((resolve) => { finish = resolve; });
  const service = new XStocksService(async () => ++calls === 1 ? [normalizeXStock(row)] : refresh, () => now);
  const first = await service.getSnapshot();
  now = 300_001;
  const stale = await service.getSnapshot();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(calls, 2);
  assert.equal((await service.getSnapshot()).stale, true);
  assert.equal(calls, 2);
  finish([normalizeXStock({ ...row, name: "Refreshed Apple xStock" })]);
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = await service.getSnapshot();
  assert.equal(fresh.stale, false);
  assert.equal(fresh.assets[0].name, "Refreshed Apple xStock");
});

test("issuer-verified private exposure is excluded without hiding the rest of the catalog", async () => {
  const privateFund = { ...row, id: "3b5de927-b421-48ec-81b1-74c8eec4925f", symbol: "RENAMED", deployments: [{ network: "Solana", address: "Xs7UsqobM3EJgMeHwdAbmDBCZH1G5WTCjatpeYcCr8x" }] };
  const catalog = await fetchXStocksCatalog(fetchPages([page([row, privateFund])]).fetcher);
  assert.equal(catalog.canonicalCount, 2); assert.equal(catalog.assets.length, 1);
  assert.equal(catalog.excluded[0].reason, "PRIVATE_EXPOSURE_REQUIRES_PRESTOCKS");
  assert.equal(catalog.assets[0].id, `xstocks:${mint}`);
});

test("rejects oversized issuer metadata and deployment collections", () => {
  for (const candidate of [
    { ...row, description: "x".repeat(10_001) },
    { ...row, name: "x".repeat(501) },
    { ...row, symbol: "x".repeat(101) },
    { ...row, underlying: { symbol: "x".repeat(501) } },
    { ...row, deployments: Array.from({ length: 101 }, () => row.deployments[0]) },
  ]) assert.throws(() => normalizeXStock(candidate));
});

test("issuer catalog bounds response bytes before JSON parsing", async () => {
  await assert.rejects(fetchXStocks(async () => new Response(" ".repeat(MAX_PROVIDER_JSON_BYTES + 1))),
    (error: unknown) => error instanceof XStocksProviderError && error.cause instanceof Error && /byte limit/.test(error.cause.message));
});

test("cold issuer failures share a cooldown and retry after fifteen seconds", async () => {
  let now = 0;
  let calls = 0;
  const failure = new Error("Issuer down");
  const service = new XStocksService(async () => {
    calls++;
    if (calls === 1) throw failure;
    return [normalizeXStock(row)];
  }, () => now);
  await assert.rejects(service.getSnapshot(), (error) => error === failure);
  now = 14_999;
  await assert.rejects(service.getSnapshot(), (error) => error === failure);
  assert.equal(calls, 1);
  now = 15_000;
  assert.equal((await service.getSnapshot()).stale, false);
  assert.equal(calls, 2);
});

test("issuer stale cooldown preserves fetchedAt and cannot extend stale availability", async () => {
  let now = 0;
  let calls = 0;
  const service = new XStocksService(async () => {
    calls++;
    if (calls > 1) throw new Error("Issuer down");
    return [normalizeXStock(row)];
  }, () => now);
  const first = await service.getSnapshot();
  now = 1_799_999;
  const stale = await service.getSnapshot();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  stale.assets[0].name = "Changed";
  const cached = await service.getSnapshot();
  assert.equal(cached.assets[0].name, row.name);
  assert.equal(cached.fetchedAt, first.fetchedAt);
  assert.equal(cached.stale, true);
  assert.equal(calls, 2);
  now = 1_800_000;
  await assert.rejects(service.getSnapshot(), /Issuer down/);
  assert.equal(calls, 2);
  now = 1_814_999;
  await assert.rejects(service.getSnapshot(), /Issuer down/);
  assert.equal(calls, 3);
});
