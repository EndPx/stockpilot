import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarketHistory } from "@stockpilot/integrations/market-history-types";
import { chartGeometry, chartPrice, isChartHistory, nearestCandle } from "../lib/market-chart";
import { candleIndexForKey, MarketChart, MarketChartMessage, PriceHistory } from "../components/market-chart";

const mint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const pool = "CKwJZwm7oj3nu4653N1EpDrqXbXAYXoPFiPeEnLouF8y";
function history(times = [900, 1800, 3600]): MarketHistory {
  return { mint, range: "1d", currency: "USD", priceBasis: "PROVIDER_REPORTED", intervalSeconds: 900, windowStart: 900, windowEnd: 5400,
    fetchedAt: "2026-09-23T00:00:00.000Z", status: "available", omittedCandles: 0,
    source: { name: "GeckoTerminal", poolAddress: pool, poolUrl: `https://www.geckoterminal.com/solana/pools/${pool}` },
    candles: times.map((time, index) => ({ time, open: 100 + index, close: 100 + index, low: 99 + index, high: 101 + index, volumeUsd: 20 })),
  };
}

test("chart validates identity, chronology, prices, closed intervals and safe attribution", () => {
  assert.equal(isChartHistory(history(), mint, "1d"), true);
  assert.equal(isChartHistory(history(), "different", "1d"), false);
  assert.equal(isChartHistory(history(), mint, "1w"), false);
  assert.equal(isChartHistory({ ...history(), priceBasis: undefined }, mint, "1d"), false);
  assert.equal(isChartHistory(history([1800, 900]), mint, "1d"), false);
  assert.equal(isChartHistory(history([900, 900]), mint, "1d"), false);
  assert.equal(isChartHistory(history([5400]), mint, "1d"), false);
  assert.equal(isChartHistory({ ...history(), status: "empty" }, mint, "1d"), false);
  assert.equal(isChartHistory({ ...history(), source: null }, mint, "1d"), false);
  assert.equal(isChartHistory({ ...history(), source: { ...history().source, poolUrl: "javascript:alert(1)" } }, mint, "1d"), false);
  assert.equal(isChartHistory({ ...history(), candles: [{ ...history().candles[0], close: NaN }] }, mint, "1d"), false);
});

test("chart uses real elapsed time and breaks line at missing intervals", () => {
  const value = history();
  const geometry = chartGeometry(value);
  assert.equal(geometry.segments.length, 2);
  assert.match(geometry.segments[0], /^M[\d.,]+ L[\d.,]+$/);
  assert.match(geometry.segments[1], /^M[\d.,]+$/);
  const [a, b, c] = value.candles;
  assert.ok(Math.abs((geometry.x(c) - geometry.x(b)) / (geometry.x(b) - geometry.x(a)) - 2) < .000001);
  assert.ok(geometry.ticks.every(Number.isFinite));
  assert.equal(nearestCandle(value, -1), 0);
  assert.equal(nearestCandle(value, 1), 2);
  assert.equal(nearestCandle(value, .4), 1);
});

test("a flat or single-candle history stays finite and is not invented performance", () => {
  const value = history([900]);
  const geometry = chartGeometry(value);
  assert.ok(geometry.ticks[0] > geometry.ticks[2]);
  assert.doesNotMatch(geometry.segments[0], /NaN|Infinity/);
  const html = renderToStaticMarkup(createElement(PriceHistory, { history: value, symbol: "AAPLx" }));
  assert.match(html, /One available candle/);
  assert.doesNotMatch(html, /0\.00%/);
  assert.match(chartPrice(.000012345), /0\.000012345/);
});

test("historical chart has keyboard inspection, equivalent table, timezone and honest gap disclosure", () => {
  const html = renderToStaticMarkup(createElement(PriceHistory, { history: history(), symbol: "AAPLx" }));
  assert.match(html, /\+\$2 \(\+2\.00%\)/);
  assert.match(html, /1D DEX pool move/);
  assert.doesNotMatch(html, /type="range"|Inspect a candle|market-chart-inspect/);
  assert.match(html, /<svg[^>]*role="slider"[^>]*tabindex="0"/);
  assert.match(html, /aria-valuemin="0" aria-valuemax="2"/);
  assert.match(html, /Use arrow keys, Home or End/);
  assert.match(html, /aria-valuetext=/);
  assert.match(html, /<table>/);
  assert.match(html, /Candle ended \(UTC\)/);
  assert.match(html, /missing trading intervals/);
  assert.match(html, /not your investment return/);
  assert.doesNotMatch(html, /Buy|Sell|Sign transaction/);
});

test("plot keyboard inspection traverses real candles and keeps endpoints bounded without a range bar", () => {
  assert.equal(candleIndexForKey("ArrowLeft", 2, 3), 1);
  assert.equal(candleIndexForKey("ArrowDown", 0, 3), 0);
  assert.equal(candleIndexForKey("ArrowRight", 2, 3), 2);
  assert.equal(candleIndexForKey("ArrowUp", 1, 3), 2);
  assert.equal(candleIndexForKey("Home", 2, 3), 0);
  assert.equal(candleIndexForKey("End", 0, 3), 2);
  assert.equal(candleIndexForKey("ArrowRight", 0, 1), 0);
  assert.equal(candleIndexForKey("Tab", 1, 3), null);
});

test("a falling pool series labels its negative move without implying stock performance", () => {
  const value = history();
  value.candles[2] = { ...value.candles[2], open: 98, high: 99, low: 97, close: 98 };
  const html = renderToStaticMarkup(createElement(PriceHistory, { history: value, symbol: "AAPLx" }));
  assert.match(html, /−\$2 \(−2\.00%\)/);
  assert.match(html, /1D DEX pool move/);
  assert.doesNotMatch(html, /underlying stock move/);
});

test("initial chart preserves loading and clearly distinguishes public/private token-price scope", () => {
  const publicHtml = renderToStaticMarkup(createElement(MarketChart, { provider: "xstocks", mint, symbol: "AAPLx" }));
  assert.match(publicHtml, /Loading price history/);
  assert.match(publicHtml, /aria-busy="true"/);
  assert.match(publicHtml, /Last 30 days/);
  assert.match(publicHtml, /not underlying stock prices/);
  assert.match(publicHtml, /DEX-reported price/);
  assert.match(publicHtml, /Normalization for token multipliers and splits is not verified/);
  assert.match(publicHtml, /Powered by CoinGecko/);
  assert.doesNotMatch(publicHtml, /<iframe|<script|<path/);
  const privateHtml = renderToStaticMarkup(createElement(MarketChart, { provider: "prestocks", mint, symbol: "SPACEX" }));
  assert.match(privateHtml, /not private-company valuations/);
});

test("empty and provider-failure chart states are distinct; neither fabricates zero prices", () => {
  const empty = renderToStaticMarkup(createElement(MarketChartMessage, { state: "empty" }));
  const error = renderToStaticMarkup(createElement(MarketChartMessage, { state: "error" }));
  assert.match(empty, /No chart data for this period/);
  assert.match(error, /temporarily unavailable/);
  assert.doesNotMatch(error, /No chart data/);
  assert.doesNotMatch(empty + error, /\$0\.00|<svg/);
});
