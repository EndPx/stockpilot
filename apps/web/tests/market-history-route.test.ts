import assert from "node:assert/strict";
import test from "node:test";
import { getAddressDecoder } from "@solana/kit";
import type { InvestmentAsset, InvestmentAssetRegistry } from "@stockpilot/core/asset-registry";
import type { MarketHistory, MarketHistoryRange } from "@stockpilot/integrations/market-history-types";
import { createMarketHistoryGet } from "../app/api/market-history/route";
import { MarketHistoryRequestError, MarketHistoryService, type MarketHistoryQuery } from "../lib/market-history";

const START = Date.parse("2026-09-23T00:00:00Z");
function mint(index = 1): string {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, index);
  return getAddressDecoder().decode(bytes).toString();
}
function query(index = 1, range: MarketHistoryRange = "1d"): MarketHistoryQuery {
  return { provider: "xstocks", mint: mint(index), range };
}
function history(address = mint(), range: MarketHistoryRange = "1d", now = START, empty = false): MarketHistory {
  return {
    mint: address, range, currency: "USD", priceBasis: "PROVIDER_REPORTED", intervalSeconds: 900,
    windowStart: Math.floor(now / 1000) - 86_400, windowEnd: Math.floor(now / 1000),
    fetchedAt: new Date(now).toISOString(), status: empty ? "empty" : "available",
    candles: empty ? [] : [{ time: Math.floor(now / 1000) - 900, open: 1, high: 2, low: 0.5, close: 1.5, volumeUsd: 10 }],
    source: empty ? null : { name: "GeckoTerminal", poolAddress: mint(999), poolUrl: `https://www.geckoterminal.com/solana/pools/${mint(999)}` },
    omittedCandles: 0,
  };
}
function asset(index: number, provider: "xstocks" | "prestocks" = "xstocks"): InvestmentAsset {
  return {
    id: `${provider}:${mint(index)}`, provider, marketType: provider === "xstocks" ? "PUBLIC_MARKET_PRODUCT" : "PRE_IPO",
    canonical: true, executionStatus: "UNKNOWN", mintAddress: mint(index), symbol: `ASSET${index}`,
    name: `Asset ${index}`, description: null, imageUrl: null, tokenPriceUsd: null,
  } as InvestmentAsset;
}
function catalog(rows = [asset(1)], stale = false): Pick<InvestmentAssetRegistry, "getSnapshot"> {
  return { async getSnapshot(provider) {
    return { assets: rows.filter((row) => row.provider === provider), sources: [], stale };
  } };
}
function request(search: string): Request {
  return new Request(`http://localhost/api/market-history?${search}`);
}
const search = (index = 1, range: MarketHistoryRange = "1d") => `provider=xstocks&mint=${mint(index)}&range=${range}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const unavailable = (error: unknown) => error instanceof MarketHistoryRequestError && error.status === 503;

test("history query validation rejects missing, duplicate, unknown and unsupported parameters before any provider", async () => {
  let calls = 0;
  const get = createMarketHistoryGet(async () => { calls++; throw new Error("Must not read providers"); });
  for (const input of [
    "", `provider=xstocks&mint=${mint()}`, `${search()}&range=1d`, `${search()}&mint=${mint()}`,
    `${search()}&provider=xstocks`, `${search()}&pool=attacker`, `${search()}&url=https://attacker.invalid`,
    `${search()}&network=ethereum`, `provider=unknown&mint=${mint()}&range=1d`,
    `provider=xstocks&mint=invalid&range=1d`, `provider=xstocks&mint=${mint()}&range=1y`,
    `provider=xstocks&mint=${mint()}&range=`, `provider=xstocks&mint=${mint()}&Range=1d`,
  ]) {
    const response = await get(request(input));
    assert.equal(response.status, 400, input);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("history is public, resolves the exact canonical provider and mint, and returns the direct series contract", async () => {
  const seen: string[] = [];
  const registry: Pick<InvestmentAssetRegistry, "getSnapshot"> = { async getSnapshot(provider) {
    seen.push(provider!);
    return { assets: [asset(1, "prestocks")], sources: [], stale: true };
  } };
  const service = new MarketHistoryService(registry, async (address, range) => {
    assert.equal(address, mint()); assert.equal(range, "1w");
    return history(address, range);
  }, () => START);
  const response = await createMarketHistoryGet((input) => service.get(input))(request(`provider=prestocks&mint=${mint()}&range=1w`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.deepEqual(await response.json(), { ...history(mint(), "1w"), catalogStale: true });
  assert.deepEqual(seen, ["prestocks"]);
});

test("unknown, excluded and wrong-provider mints return 404 without history-provider calls, even after cache population", async () => {
  const rows = [asset(1)];
  let calls = 0;
  const service = new MarketHistoryService(catalog(rows), async (address, range) => { calls++; return history(address, range); }, () => START);
  const get = createMarketHistoryGet((input) => service.get(input));
  assert.equal((await get(request(search(2)))).status, 404);
  assert.equal((await get(request(`provider=prestocks&mint=${mint()}&range=1d`))).status, 404);
  assert.equal(calls, 0);
  assert.equal((await get(request(search()))).status, 200);
  rows.length = 0;
  assert.equal((await get(request(search()))).status, 404);
  assert.equal(calls, 1);
});

test("catalog and history-provider failures are sanitized 503s, never empty successes", async () => {
  let loads = 0;
  const failedCatalog: Pick<InvestmentAssetRegistry, "getSnapshot"> = { async getSnapshot() { throw new Error("private catalog diagnostic"); } };
  const service = new MarketHistoryService(failedCatalog, async () => { loads++; return history(); }, () => START);
  const catalogResponse = await createMarketHistoryGet((input) => service.get(input))(request(search()));
  assert.equal(catalogResponse.status, 503);
  assert.equal(loads, 0);
  const failedHistory = new MarketHistoryService(catalog(), async () => { throw new Error("private upstream diagnostic"); }, () => START);
  const providerResponse = await createMarketHistoryGet((input) => failedHistory.get(input))(request(search()));
  for (const response of [catalogResponse, providerResponse]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), /private|diagnostic/);
  }
});

test("positive and empty histories are cached for five minutes, with isolated returned values", async () => {
  for (const empty of [false, true]) {
    let now = START;
    let calls = 0;
    const service = new MarketHistoryService(catalog(), async (address, range) => { calls++; return history(address, range, now, empty); }, () => now);
    const first = await service.get(query());
    first.candles.push({ time: 0, open: 9, high: 9, low: 9, close: 9, volumeUsd: 9 });
    now += 299_999;
    const second = await service.get(query());
    assert.equal(second.candles.length, empty ? 0 : 1);
    assert.equal(second.status, empty ? "empty" : "available");
    assert.equal(second.fetchedAt, new Date(START).toISOString());
    assert.equal(calls, 1);
    now++;
    assert.equal((await service.get(query())).fetchedAt, new Date(now).toISOString());
    assert.equal(calls, 2);
  }
});

test("concurrent identical requests share a job and returned objects are independent", async () => {
  let calls = 0;
  const pending = deferred<MarketHistory>();
  const service = new MarketHistoryService(catalog(), async () => { calls++; return pending.promise; }, () => START);
  const requests = Array.from({ length: 10 }, () => service.get(query()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  pending.resolve(history());
  const results = await Promise.all(requests);
  results[0].candles[0].close = 999;
  assert.equal(results[1].candles[0].close, 1.5);
});

test("at most two jobs run concurrently; rejected admission consumes no call credits", async () => {
  const pending = [deferred<MarketHistory>(), deferred<MarketHistory>()];
  let calls = 0;
  const service = new MarketHistoryService(catalog([1, 2, 3, 4].map((i) => asset(i))), async (address, range) => {
    const index = calls++;
    return index < 2 ? pending[index].promise : history(address, range);
  }, () => START);
  const first = service.get(query(1));
  const second = service.get(query(2));
  await assert.rejects(service.get(query(3)), unavailable);
  assert.equal(calls, 2);
  pending[0].resolve(history(mint(1)));
  pending[1].resolve(history(mint(2)));
  await Promise.all([first, second]);
  await service.get(query(3));
  await service.get(query(4));
  assert.equal(calls, 4);
});

test("a sliding minute permits four two-credit jobs across providers and ranges, including empty results", async () => {
  let now = START;
  let calls = 0;
  const service = new MarketHistoryService(catalog([asset(1), asset(2), asset(3, "prestocks")]), async (address, range) => {
    calls++; return history(address, range, now, true);
  }, () => now);
  await service.get(query(1, "1d"));
  now += 10_000;
  await service.get(query(1, "1w"));
  await service.get(query(2, "1d"));
  await service.get({ provider: "prestocks", mint: mint(3), range: "1d" });
  now = START + 59_999;
  await assert.rejects(service.get(query(2, "1w")), unavailable);
  assert.equal(calls, 4);
  now++;
  await service.get(query(2, "1w"));
  assert.equal(calls, 5);
  await assert.rejects(service.get(query(2, "1m")), unavailable);
});

test("failure cooldown blocks immediate retries, does not auto-retry and does not refund provider credits", async () => {
  let now = START;
  let calls = 0;
  const service = new MarketHistoryService(catalog(), async () => { calls++; throw new Error("upstream down"); }, () => now);
  await assert.rejects(service.get(query()), unavailable);
  now += 14_999;
  await assert.rejects(service.get(query()), unavailable);
  assert.equal(calls, 1);
  now++;
  await assert.rejects(service.get(query()), unavailable);
  now += 15_000;
  await assert.rejects(service.get(query()), unavailable);
  now += 15_000;
  await assert.rejects(service.get(query()), unavailable);
  assert.equal(calls, 4);
  await assert.rejects(service.get(query(1, "1w")), unavailable);
  assert.equal(calls, 4);
});

test("pending jobs retain both call credits through sixty seconds after completion", async () => {
  let now = START;
  let calls = 0;
  const pending = deferred<MarketHistory>();
  const service = new MarketHistoryService(catalog([1, 2, 3, 4, 5].map((index) => asset(index))), async (address, range) => {
    calls++;
    if (address === mint(1)) return pending.promise;
    return history(address, range, now);
  }, () => now);
  const first = service.get(query(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  now += 120_000;
  await service.get(query(2));
  await service.get(query(3));
  await service.get(query(4));
  await assert.rejects(service.get(query(5)), unavailable);
  assert.equal(calls, 4);
  pending.resolve(history(mint(1), "1d", now));
  await first;
  now += 59_999;
  await assert.rejects(service.get(query(5)), unavailable);
  assert.equal(calls, 4);
  now++;
  await service.get(query(5));
  assert.equal(calls, 5);
});

test("expired data is not used after a provider failure and history older than 24 hours is rejected", async () => {
  let now = START;
  let fail = false;
  const service = new MarketHistoryService(catalog(), async () => {
    if (fail) throw new Error("upstream down");
    return history();
  }, () => now);
  await service.get(query());
  now += 300_000;
  fail = true;
  await assert.rejects(service.get(query()), unavailable);
  now += 24 * 60 * 60_000;
  await assert.rejects(service.get(query()), unavailable);
  const tooOld = new MarketHistoryService(catalog(), async () => history(mint(), "1d", now - 24 * 60 * 60_000), () => now);
  await assert.rejects(tooOld.get(query()), unavailable);
});

test("the 128-series LRU pins in-flight keys so eviction cannot admit duplicate jobs", async () => {
  let now = START;
  const rows = Array.from({ length: 131 }, (_, index) => asset(index + 1));
  const counts = new Map<string, number>();
  let hold = false;
  const pending = deferred<MarketHistory>();
  const service = new MarketHistoryService(catalog(rows), async (address, range) => {
    counts.set(address, (counts.get(address) ?? 0) + 1);
    if (hold && address === mint(1)) return pending.promise;
    return history(address, range, now);
  }, () => now);
  for (let index = 1; index <= 128; index++) {
    now += 60_000;
    await service.get(query(index));
  }
  now += 60_000;
  hold = true;
  const first = service.get(query(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Reads move recency even when admission rejects an expired series refresh.
  // This makes the pinned request the least-recently-used entry.
  for (let index = 2; index <= 128; index++) {
    await service.get(query(index)).catch((error: unknown) => { assert.ok(unavailable(error)); });
  }
  now += 60_000;
  await service.get(query(129));
  const same = service.get(query(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(counts.get(mint(1)), 2);
  pending.resolve(history(mint(1), "1d", now));
  await Promise.all([first, same]);
  now += 60_000;
  await service.get(query(130));
  const cache = (service as unknown as { entries: Map<string, unknown> }).entries;
  assert.equal(cache.size, 128);
  assert.equal(cache.has(`xstocks:${mint(1)}:1d`), true);
});

test("LRU churn cannot evict an active failure cooldown and re-admit its provider job", async () => {
  let now = START;
  let callsForFirst = 0;
  let failFirst = false;
  const rows = Array.from({ length: 129 }, (_, index) => asset(index + 1));
  const service = new MarketHistoryService(catalog(rows), async (address, range) => {
    if (address === mint(1)) {
      callsForFirst++;
      if (failFirst) throw new Error("upstream down");
    }
    return history(address, range, now);
  }, () => now);
  for (let index = 1; index <= 128; index++) {
    now += 60_000;
    await service.get(query(index));
  }
  now += 59_999;
  failFirst = true;
  await assert.rejects(service.get(query()), unavailable);
  for (let index = 2; index <= 128; index++) {
    await service.get(query(index)).catch((error: unknown) => { assert.ok(unavailable(error)); });
  }
  now++; // Releases the previous minute's final fill job, before the cooldown ends.
  await service.get(query(129));
  await assert.rejects(service.get(query()), unavailable);
  assert.equal(callsForFirst, 2);
  const cache = (service as unknown as { entries: Map<string, unknown> }).entries;
  assert.equal(cache.size, 128);
  assert.equal(cache.has(`xstocks:${mint(1)}:1d`), true);
});
