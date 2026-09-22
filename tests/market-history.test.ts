import assert from "node:assert/strict";
import test from "node:test";
import { fetchMarketHistory, MarketHistoryError } from "@stockpilot/integrations/market-history";
import type { MarketHistoryRange } from "@stockpilot/integrations/market-history-types";

const MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const OTHER = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const POOL = "Chroid93DKzmgDYmCJELZ6CNC3SZ8WfRXzCkcqVtRy1r";
const SECOND_POOL = "CKwJZwm7oj3nu4653N1EpDrqXbXAYXoPFiPeEnLouF8y";
const NOW = Date.UTC(2026, 8, 22, 19, 43);
const end = (interval = 3_600) => Math.floor(NOW / 1000 / interval) * interval;
const bar = (time: number, close = 11) => [time, 10, 12, 9, close, 100];
const token = (mint: string) => ({ data: { id: `solana_${mint}`, type: "token" } });
function pool(address = POOL, base = MINT, quote = USDC, liquidity = "1000", volume?: unknown) {
  return {
    id: `solana_${address}`, type: "pool",
    attributes: { address, reserve_in_usd: liquidity, ...(volume === undefined ? {} : { volume_usd: { h24: volume } }) },
    relationships: { base_token: token(base), quote_token: token(quote) },
  };
}
function history(rows: unknown[] = [bar(end() - 3_600)], base = MINT, quote = USDC) {
  return { data: { attributes: { ohlcv_list: rows } }, meta: { base: { address: base }, quote: { address: quote } } };
}
function mock(payloads: unknown[]) {
  const calls: { url: URL; options: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), options: init ?? {} });
    const next = payloads[calls.length - 1];
    assert.notEqual(next, undefined, "No unexpected provider requests");
    return next instanceof Response ? next : Response.json(next);
  };
  return { calls, fetcher };
}
const unavailable = (error: unknown) => error instanceof MarketHistoryError && error.code === "MARKET_HISTORY_UNAVAILABLE";

test("history uses a fixed host, exact mint, USD, versioned requests and one shared deadline", async () => {
  const { calls, fetcher } = mock([{ data: [pool()] }, history()]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url.origin, "https://api.geckoterminal.com");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.cache, "no-store");
    assert.equal(new Headers(call.options.headers).get("accept"), "application/json;version=20230203");
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].options.signal, calls[1].options.signal);
  assert.equal(calls[0].url.pathname, `/api/v2/networks/solana/tokens/${MINT}/pools`);
  assert.equal(calls[1].url.searchParams.get("currency"), "usd");
  assert.equal(calls[1].url.searchParams.get("token"), MINT);
  assert.equal(calls[1].url.searchParams.get("include_empty_intervals"), "false");
  assert.equal(calls[1].url.searchParams.get("before_timestamp"), String(end() - 1));
  assert.equal(result.status, "available");
  assert.equal(result.currency, "USD");
  assert.equal(result.mint, MINT);
  assert.equal(result.fetchedAt, new Date(NOW).toISOString());
  assert.deepEqual(result.source, { name: "GeckoTerminal", poolAddress: POOL, poolUrl: `https://www.geckoterminal.com/solana/pools/${POOL}` });
});

test("range contract uses closed 15-minute, hourly and four-hour buckets", async () => {
  const ranges = [
    ["1d", "minute", 15, 900, 96],
    ["1w", "hour", 1, 3_600, 168],
    ["1m", "hour", 4, 14_400, 180],
  ] as const;
  for (const [range, timeframe, aggregate, interval, count] of ranges) {
    const cutoff = end(interval);
    const { calls, fetcher } = mock([{ data: [pool()] }, history([bar(cutoff - interval)])]);
    const result = await fetchMarketHistory(MINT, range, { fetch: fetcher, now: () => NOW });
    assert.ok(calls[1].url.pathname.endsWith(`/ohlcv/${timeframe}`));
    assert.equal(calls[1].url.searchParams.get("aggregate"), String(aggregate));
    assert.equal(calls[1].url.searchParams.get("limit"), String(count + 2));
    assert.equal(result.intervalSeconds, interval);
    assert.equal(result.windowEnd, cutoff);
    assert.equal(result.windowStart, cutoff - interval * count);
  }
});

test("chooses highest liquidity among exact mint pairs, including target on quote side", async () => {
  const { calls, fetcher } = mock([
    { data: [pool(), pool(SECOND_POOL, SOL, MINT, "2000"), pool(OTHER, MINT, OTHER, "900000"), pool(SOL, OTHER, USDC, "1000000")] },
    history(undefined, SOL, MINT),
  ]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.equal(result.source?.poolAddress, SECOND_POOL);
  assert.ok(calls[1].url.pathname.includes(SECOND_POOL));
  assert.equal(calls[1].url.searchParams.get("token"), MINT);
});

test("active trading pool beats a dormant pool with greater liquidity", async () => {
  const { fetcher } = mock([
    { data: [pool(SECOND_POOL, MINT, USDC, "213433", "0"), pool(POOL, MINT, USDC, "10651", "5509")] }, history(),
  ]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.equal(result.source?.poolAddress, POOL);
});

test("highest recent volume wins among active pools before liquidity", async () => {
  const { fetcher } = mock([
    { data: [pool(SECOND_POOL, MINT, USDC, "50255", "37"), pool(POOL, MINT, USDC, "10651", "5509")] }, history(),
  ]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.equal(result.source?.poolAddress, POOL);
});

test("zero or unavailable volume falls back to liquidity", async () => {
  for (const volume of [undefined, null, "0", 0]) {
    const { fetcher } = mock([
      { data: [pool(POOL, MINT, USDC, "1000", "0"), pool(SECOND_POOL, MINT, USDC, "2000", volume)] }, history(),
    ]);
    const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
    assert.equal(result.source?.poolAddress, SECOND_POOL);
  }
});

test("malformed or unsafe recent pool volume fails closed", async () => {
  for (const volume of [-1, "-1", "Infinity", "NaN", Number.MAX_SAFE_INTEGER + 1, true, {}, "", " "]) {
    const { calls, fetcher } = mock([{ data: [pool(POOL, MINT, USDC, "1000", volume)] }]);
    await assert.rejects(fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW }), unavailable);
    assert.equal(calls.length, 1);
  }
});

test("no eligible pool produces empty history without an OHLCV request", async () => {
  for (const pools of [[], [pool(POOL, MINT, OTHER)], [pool(POOL, OTHER, USDC)], [pool(POOL, MINT, USDC, "0")]]) {
    const { calls, fetcher } = mock([{ data: pools }]);
    const result = await fetchMarketHistory(MINT, "1d", { fetch: fetcher, now: () => NOW });
    assert.equal(calls.length, 1);
    assert.equal(result.status, "empty");
    assert.equal(result.source, null);
    assert.deepEqual(result.candles, []);
  }
});

test("empty OHLCV retains the verified source and remains empty", async () => {
  const { fetcher } = mock([{ data: [pool()] }, history([])]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.equal(result.status, "empty");
  assert.equal(result.source?.poolAddress, POOL);
  assert.equal(result.omittedCandles, 0);
});

test("only out-of-window OHLCV is legitimate empty history", async () => {
  const { fetcher } = mock([{ data: [pool()] }, history([bar(end()), bar(end() - 169 * 3_600)])]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.equal(result.status, "empty");
  assert.deepEqual(result.candles, []);
  assert.equal(result.omittedCandles, 0);
});

test("rejects invalid mint/range before requesting upstream", async () => {
  const { calls, fetcher } = mock([]);
  for (const [mint, range] of [["../../../metadata", "1d"], [MINT, "toString"], [MINT, "all"]]) {
    await assert.rejects(fetchMarketHistory(mint, range as MarketHistoryRange, { fetch: fetcher, now: () => NOW }), unavailable);
  }
  assert.equal(calls.length, 0);
});

test("rejects malformed identities and mismatched pool addresses before history", async () => {
  const badToken = pool(); badToken.relationships.base_token.data.id = `ethereum_${MINT}`;
  const badAddress = pool(); badAddress.attributes.address = "https://attacker.invalid";
  const badPoolId = pool(); badPoolId.id = `solana_${SECOND_POOL}`;
  const badType = pool(); badType.relationships.quote_token.data.type = "pool";
  for (const candidate of [badToken, badAddress, badPoolId, badType, pool(POOL, MINT, USDC, "Infinity")]) {
    const { calls, fetcher } = mock([{ data: [candidate] }]);
    await assert.rejects(fetchMarketHistory(MINT, "1d", { fetch: fetcher, now: () => NOW }), unavailable);
    assert.equal(calls.length, 1);
  }
});

test("rejects OHLCV metadata that does not match the selected base and quote", async () => {
  for (const payload of [history(undefined, OTHER), history(undefined, MINT, SOL), history(undefined, USDC, MINT), { data: history().data }]) {
    const { fetcher } = mock([{ data: [pool()] }, payload]);
    await assert.rejects(fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW }), unavailable);
  }
});

test("filters actual window and open buckets, sorts oldest first, and preserves gaps", async () => {
  const start = end() - 168 * 3_600;
  const { fetcher } = mock([{ data: [pool()] }, history([
    bar(end()), bar(end() + 3_600), bar(start - 3_600),
    bar(end() - 3_600), bar(start), bar(end() - 10_800),
  ])]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.deepEqual(result.candles.map(({ time }) => time), [start, end() - 10_800, end() - 3_600]);
  assert.equal(result.omittedCandles, 0);
});

test("identical timestamps dedupe but all conflicting copies are omitted", async () => {
  const conflictTime = end() - 3_600;
  const sameTime = end() - 7_200;
  const { fetcher } = mock([{ data: [pool()] }, history([
    bar(conflictTime), bar(sameTime), bar(conflictTime, 10), bar(conflictTime), bar(sameTime),
  ])]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.deepEqual(result.candles.map(({ time }) => time), [sameTime]);
  assert.equal(result.omittedCandles, 3);
});

test("entirely malformed, nonnumeric, unaligned or inconsistent candles fail instead of appearing empty", async () => {
  const badRows: unknown[] = [
    [end() - 3_600, 10, 8, 9, 11, 100],
    [end() - 7_200, 10, 12, 11, 11, 100],
    [end() - 10_800, 10, 12, 9, 11, -1],
    [end() - 14_400, 0, 12, 0, 11, 100],
    [end() - 18_000, "10", 12, 9, 11, 100],
    [end() - 21_600, null, 12, 9, 11, 100],
    bar(end() - 100), [end() - 25_200, 10], {},
  ];
  const { fetcher } = mock([{ data: [pool()] }, history(badRows)]);
  await assert.rejects(fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW }), unavailable);
});

test("a wholly ambiguous duplicate timestamp fails instead of appearing empty", async () => {
  const time = end() - 3_600;
  const { fetcher } = mock([{ data: [pool()] }, history([bar(time), [time, 10]])]);
  await assert.rejects(fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW }), unavailable);
});

test("pathological finite prices and volume are omitted while safe boundary values remain valid", async () => {
  const price = (offset: number, value: number, volume = 100) => [end() - offset * 3_600, value, value, value, value, volume];
  const { fetcher } = mock([{ data: [pool()] }, history([
    price(1, 1e-16), price(2, 1e16), price(3, Number.MAX_VALUE),
    price(4, 10, Number.MAX_SAFE_INTEGER + 1),
    price(5, 1e-15, 0), price(6, 1e15, Number.MAX_SAFE_INTEGER),
  ])]);
  const result = await fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW });
  assert.deepEqual(result.candles.map(({ time }) => time), [end() - 6 * 3_600, end() - 5 * 3_600]);
  assert.equal(result.omittedCandles, 4);
});

test("oversized bodies and collections fail before being exposed", async () => {
  const body = new Response("{}", { headers: { "content-length": String(512 * 1024 + 1) } });
  for (const payload of [body, { data: Array.from({ length: 21 }, () => pool()) }, { data: {} }]) {
    const { fetcher } = mock([payload]);
    await assert.rejects(fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW }), unavailable);
  }
  const { fetcher } = mock([{ data: [pool()] }, history(Array.from({ length: 171 }, () => bar(end() - 3_600)))]);
  await assert.rejects(fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW }), unavailable);
});

test("HTTP failures, rate limits and transport errors remain sanitized errors", async () => {
  for (const status of [301, 429, 500]) {
    const { fetcher } = mock([new Response("private upstream detail", { status })]);
    await assert.rejects(fetchMarketHistory(MINT, "1w", { fetch: fetcher, now: () => NOW }), (error: unknown) => {
      assert.ok(error instanceof MarketHistoryError);
      assert.equal(error.message, "Market history is temporarily unavailable.");
      assert.equal(error.retryAfterSeconds, status === 429 ? 60 : undefined);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  await assert.rejects(fetchMarketHistory(MINT, "1w", {
    now: () => NOW,
    fetch: async () => { throw new Error("sensitive provider URL"); },
  }), (error: unknown) => unavailable(error) && !(error as Error).message.includes("sensitive"));
});
