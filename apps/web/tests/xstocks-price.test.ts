import assert from "node:assert/strict";
import test from "node:test";
import { fetchXStockPrice, XStocksPriceService } from "@stockpilot/integrations/xstocks-price";

test("issuer price adapter uses only the official symbol endpoint and validates the quote", async () => {
  let requested = "";
  const fetcher = (async (url: string, options: RequestInit) => {
    requested = url;
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    return Response.json({ quote: 774.597 });
  }) as typeof fetch;
  assert.equal(await fetchXStockPrice("SPYx", fetcher), 774.597);
  assert.equal(requested, "https://api.xstocks.fi/api/v2/public/assets/SPYx/price-data");
  await assert.rejects(fetchXStockPrice("../other", fetcher), /Invalid xStocks symbol/);
  assert.equal(await fetchXStockPrice("SPYx", (async () => Response.json({ quote: null })) as typeof fetch), null);
  for (const quote of [-1, 0, "100"]) {
    await assert.rejects(fetchXStockPrice("SPYx", (async () => Response.json({ quote })) as typeof fetch), /Invalid xStocks quote/);
  }
  await assert.rejects(fetchXStockPrice("SPYx", (async () => new Response('{"quote":1e999}')) as typeof fetch), /Invalid xStocks quote/);
});

test("server price cache deduplicates requests and serves stale quotes during an issuer outage", async () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  const prices = new XStocksPriceService(async () => {
    calls++;
    if (calls > 1) throw new Error("issuer outage");
    return 123.45;
  }, () => now, 2, 100);
  const first = await prices.getPrices(["SPYx", "SPYx"]);
  assert.equal(first.get("SPYx")?.quote, 123.45);
  assert.equal(first.get("SPYx")?.stale, false);
  assert.equal(calls, 1);
  await prices.getPrices(["SPYx"]);
  assert.equal(calls, 1);

  now += 61_000;
  const stale = await prices.getPrices(["SPYx"]);
  assert.equal(stale.get("SPYx")?.quote, 123.45);
  assert.equal(stale.get("SPYx")?.stale, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  await prices.getPrices(["SPYx"]);
  assert.equal(calls, 2); // failure backoff, no retry per viewer

  now += 600_000;
  assert.equal((await prices.getPrices(["SPYx"])).has("SPYx"), false);
});

test("a slow cold batch returns promptly and completes the cache in the background", async () => {
  let resolveLoad!: (value: number) => void;
  const pending = new Promise<number>((resolve) => { resolveLoad = resolve; });
  const prices = new XStocksPriceService(async () => pending, Date.now, 2, 10);
  assert.equal((await prices.getPrices(["AAPLx"])).size, 0);
  resolveLoad(200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await prices.getPrices(["AAPLx"])).get("AAPLx")?.quote, 200);
});

test("price batches respect the server-side concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const prices = new XStocksPriceService(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return 1;
  }, Date.now, 2, 10);
  await prices.getPrices(["Ax", "Bx", "Cx"]);
  assert.equal(peak, 2);
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setImmediate(resolve));
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await prices.getPrices(["Ax", "Bx", "Cx"])).size, 3);
});
