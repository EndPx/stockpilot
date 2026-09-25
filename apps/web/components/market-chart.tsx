"use client";

import { useEffect, useId, useState } from "react";
import type { MarketHistory, MarketHistoryRange } from "@stockpilot/integrations/market-history-types";
import { CHART_HEIGHT, CHART_WIDTH, chartGeometry, chartPrice, chartTime, isChartHistory, nearestCandle } from "../lib/market-chart";

type ChartState = { key: string; history: MarketHistory | null; error: boolean };
const ranges: { value: MarketHistoryRange; label: string; name: string }[] = [
  { value: "1d", label: "1D", name: "Last 24 hours" },
  { value: "1w", label: "1W", name: "Last 7 days" },
  { value: "1m", label: "1M", name: "Last 30 days" },
];

export function candleIndexForKey(key: string, current: number, count: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(0, current - 1);
  if (key === "ArrowRight" || key === "ArrowUp") return Math.min(count - 1, current + 1);
  return null;
}

export function MarketChartMessage({ state }: { state: "loading" | "empty" | "error" }) {
  return <div className="market-chart-message" role="status">
    <strong>{state === "loading" ? "Loading price history…" : state === "empty" ? "No chart data for this period" : "Price history is temporarily unavailable"}</strong>
    <p>{state === "loading" ? "Checking the canonical token’s completed trading candles." : state === "empty"
      ? "A supported pool or completed trades may not be available. Try a longer period."
      : "The data source may be busy or rate-limited. Wait a moment, then try again."}</p>
  </div>;
}

export function PriceHistory({ history, symbol }: { history: MarketHistory; symbol: string }) {
  const [selectedIndex, setSelectedIndex] = useState(history.candles.length - 1);
  const selected = history.candles[Math.max(0, Math.min(selectedIndex, history.candles.length - 1))];
  const geometry = chartGeometry(history);
  const first = history.candles[0];
  const last = history.candles[history.candles.length - 1];
  const priceDelta = last.close - first.close;
  const change = (priceDelta / first.close) * 100;
  const deltaSign = priceDelta > 0 ? "+" : priceDelta < 0 ? "−" : "";
  const periodLabel = history.range === "1d" ? "1D" : history.range === "1w" ? "1W" : "1M";
  const hasGaps = history.candles.some((candle, index) => index > 0 && candle.time - history.candles[index - 1].time > history.intervalSeconds);
  const intervalLabel = history.intervalSeconds < 3600 ? `${history.intervalSeconds / 60}-minute` : `${history.intervalSeconds / 3600}-hour`;
  const selectedDescription = `${chartPrice(selected.close)} · ${chartTime(selected.time + history.intervalSeconds)} UTC`;
  function inspectAt(clientX: number, plot: SVGSVGElement) {
    const bounds = plot.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const plotX = ((clientX - bounds.left) / bounds.width) * CHART_WIDTH;
    setSelectedIndex(nearestCandle(history, (plotX - 12) / (CHART_WIDTH - 24)));
  }
  return <>
    <div className="market-chart-reading">
      <div><strong>{chartPrice(selected.close)}</strong><span>Candle closed {chartTime(selected.time + history.intervalSeconds)} UTC</span></div>
      <div className="market-chart-change"><b className={change < 0 ? "market-chart-down" : change > 0 ? "market-chart-up" : ""}>{history.candles.length > 1 ? `${deltaSign}${chartPrice(Math.abs(priceDelta))} (${deltaSign}${Math.abs(change).toFixed(2)}%)` : "—"}</b><span>{history.candles.length > 1 ? `${periodLabel} DEX pool move · available candles` : "One available candle"}</span></div>
    </div>
    <div className="market-chart-plot">
      <div className="market-chart-axis" aria-hidden="true">{geometry.ticks.map((tick, index) => <span key={index}>{chartPrice(tick)}</span>)}</div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" role="slider" tabIndex={0}
        aria-roledescription="price chart" aria-valuemin={0} aria-valuemax={history.candles.length - 1}
        aria-valuenow={selectedIndex} aria-valuetext={selectedDescription}
        aria-label={`${symbol} provider-reported token close prices in USD. ${history.candles.length} completed ${intervalLabel} candles. Units are not normalized to issuer or wallet display units. Use arrow keys, Home or End, or the data table below to inspect prices.`}
        onKeyDown={(event) => {
          const next = candleIndexForKey(event.key, selectedIndex, history.candles.length);
          if (next === null) return;
          event.preventDefault();
          setSelectedIndex(next);
        }}
        onPointerDown={(event) => {
          inspectAt(event.clientX, event.currentTarget);
          event.currentTarget.focus();
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse") return;
          inspectAt(event.clientX, event.currentTarget);
        }}>
        {geometry.ticks.map((tick, index) => <line key={index} className="market-chart-grid" x1="12" x2={CHART_WIDTH - 12} y1={geometry.y(tick)} y2={geometry.y(tick)} vectorEffect="non-scaling-stroke" />)}
        {geometry.segments.map((path, index) => <path key={index} d={path} className="market-chart-line" vectorEffect="non-scaling-stroke" />)}
        {history.candles.map((candle) => <circle key={candle.time} cx={geometry.x(candle)} cy={geometry.y(candle.close)} r="2" className="market-chart-point" />)}
        <line className="market-chart-cursor" x1={geometry.x(selected)} x2={geometry.x(selected)} y1="8" y2={CHART_HEIGHT - 8} vectorEffect="non-scaling-stroke" />
        <circle cx={geometry.x(selected)} cy={geometry.y(selected.close)} r="4" className="market-chart-selected" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
    <div className="market-chart-dates" aria-hidden="true"><span>{chartTime(history.windowStart, history.range !== "1d")}</span><span>{chartTime(history.windowEnd, history.range !== "1d")}</span></div>
    <div className="market-chart-context">
      <p>{hasGaps ? "Gaps indicate missing trading intervals; no prices are filled in. " : ""}Change compares the first and last available closes, not your investment return. {history.range === "1m" ? "1M covers 30 days. " : ""}{history.omittedCandles > 0 ? "Ambiguous or invalid candles were omitted. " : ""}Last trade candle ended {chartTime(last.time + history.intervalSeconds)} UTC.</p>
      <details className="market-chart-data"><summary>View price data ({history.candles.length} candles)</summary>
        <div className="market-chart-table" role="region" aria-label={`${symbol} historical price data`} tabIndex={0}><table><caption>Completed candle closes for {symbol}. Times in UTC.</caption><thead><tr><th scope="col">Candle ended (UTC)</th><th scope="col">Close (USD)</th></tr></thead><tbody>{history.candles.map((candle) => <tr key={candle.time}><td>{chartTime(candle.time + history.intervalSeconds)}</td><td>{chartPrice(candle.close)}</td></tr>)}</tbody></table></div>
      </details>
    </div>
  </>;
}

export function MarketChart({ provider, mint, symbol }: { provider: "xstocks" | "prestocks"; mint: string; symbol: string }) {
  const [range, setRange] = useState<MarketHistoryRange>("1d");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ChartState | null>(null);
  const titleId = useId();
  const requestKey = `${provider}:${mint}:${range}:${attempt}`;
  const current = state?.key === requestKey ? state : null;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const query = new URLSearchParams({ provider, mint, range });
    void fetch(`/api/market-history?${query}`, { signal: controller.signal, cache: "no-store", credentials: "omit" })
      .then(async (response) => {
        if (!response.ok) throw new Error("History unavailable");
        const history: unknown = await response.json();
        if (!isChartHistory(history, mint, range)) throw new Error("Invalid history");
        if (active) setState({ key: requestKey, history, error: false });
      })
      .catch(() => { if (active) setState({ key: requestKey, history: null, error: true }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [provider, mint, range, requestKey]);

  const history = current?.history;
  return <section className="surface market-chart" aria-labelledby={titleId}>
    <div className="surface-header market-chart-header"><div><p className="eyebrow">Token history / Solana</p><h2 id={titleId}>DEX-reported price <span>USD</span></h2></div>
      <div className="market-chart-ranges" role="group" aria-label="Price history period">{ranges.map((option) => <button key={option.value} type="button" aria-label={option.name} aria-pressed={range === option.value} onClick={() => setRange(option.value)}>{option.label}</button>)}</div>
    </div>
    <p className="market-chart-unit-note"><strong>Provider units.</strong> Normalization for token multipliers and splits is not verified. Do not compare directly with issuer quotes or wallet balances.</p>
    <div aria-busy={!current}>
      {!current ? <MarketChartMessage state="loading" /> : current.error ? <><MarketChartMessage state="error" /><button type="button" className="secondary-button market-chart-retry" onClick={() => setAttempt((value) => value + 1)}>Retry price history</button></> : history?.status === "available" ? <PriceHistory key={requestKey} history={history} symbol={symbol} /> : <MarketChartMessage state="empty" />}
    </div>
    <div className="market-chart-source">
      <p>Single-pool token prices on Solana, not {provider === "xstocks" ? "underlying stock prices" : "private-company valuations"} or executable quotes.</p>
      <div>{history?.source && <a href={history.source.poolUrl} target="_blank" rel="noopener noreferrer">Pool on GeckoTerminal<span className="sr-only"> (opens in a new tab)</span></a>}<a href="https://www.coingecko.com/en/api" target="_blank" rel="noopener noreferrer">Powered by CoinGecko<span className="sr-only"> (opens in a new tab)</span></a></div>
      {history && <p>Fetched {chartTime(Date.parse(history.fetchedAt) / 1000)} UTC · May be cached for up to 5 minutes.</p>}
    </div>
  </section>;
}
