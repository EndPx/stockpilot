import type { MarketHistory, MarketHistoryCandle } from "@stockpilot/integrations/market-history-types";

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 220;
const INSET = 12;
const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumSignificantDigits: 6,
});
const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function chartPrice(value: number): string {
  return priceFormatter.format(value);
}

export function chartTime(time: number, short = false): string {
  return (short ? dayFormatter : timeFormatter).format(new Date(time * 1000));
}

/** The API already validates provider data. Guard the rendering boundary too. */
export function isChartHistory(value: unknown, mint: string, range: string): value is MarketHistory {
  if (!value || typeof value !== "object") return false;
  const data = value as MarketHistory;
  if (data.mint !== mint || data.range !== range || data.currency !== "USD" || data.priceBasis !== "PROVIDER_REPORTED" ||
    !["available", "empty"].includes(data.status) ||
    !Number.isSafeInteger(data.windowStart) || !Number.isSafeInteger(data.windowEnd) ||
    data.windowEnd <= data.windowStart || !Number.isSafeInteger(data.intervalSeconds) || data.intervalSeconds <= 0 ||
    !Number.isFinite(Date.parse(data.fetchedAt)) || !Number.isSafeInteger(data.omittedCandles) || data.omittedCandles < 0 ||
    !Array.isArray(data.candles) || data.candles.length > 200 ||
    (data.status === "available") !== (data.candles.length > 0)) return false;
  if (data.source !== null && (!data.source || data.source.name !== "GeckoTerminal" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.source.poolAddress) ||
    data.source.poolUrl !== `https://www.geckoterminal.com/solana/pools/${data.source.poolAddress}`)) return false;
  if (data.candles.length && !data.source) return false;
  return data.candles.every((candle, index) => candle &&
    Number.isSafeInteger(candle.time) && candle.time >= data.windowStart &&
    candle.time + data.intervalSeconds <= data.windowEnd &&
    (index === 0 || candle.time > data.candles[index - 1].time) &&
    [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price >= 1e-15 && price <= 1e15) &&
    candle.low <= Math.min(candle.open, candle.close) && candle.high >= Math.max(candle.open, candle.close) &&
    Number.isFinite(candle.volumeUsd) && candle.volumeUsd >= 0);
}

export function chartGeometry(history: MarketHistory) {
  const values = history.candles.map((candle) => candle.close);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * .12, high * .001);
  const minimum = Math.max(0, low - padding);
  const maximum = high + padding;
  const x = (candle: MarketHistoryCandle) => INSET +
    ((candle.time + history.intervalSeconds - history.windowStart) / (history.windowEnd - history.windowStart)) * (CHART_WIDTH - INSET * 2);
  const y = (price: number) => CHART_HEIGHT - INSET -
    ((price - minimum) / (maximum - minimum)) * (CHART_HEIGHT - INSET * 2);
  const segments: string[] = [];
  history.candles.forEach((candle, index) => {
    const point = `${x(candle).toFixed(2)},${y(candle.close).toFixed(2)}`;
    if (!index || candle.time - history.candles[index - 1].time > history.intervalSeconds) segments.push(`M${point}`);
    else segments[segments.length - 1] += ` L${point}`;
  });
  return { x, y, segments, ticks: [maximum, (maximum + minimum) / 2, minimum] };
}

export function nearestCandle(history: MarketHistory, ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  const time = history.windowStart + clamped * (history.windowEnd - history.windowStart);
  let nearest = 0;
  history.candles.forEach((candle, index) => {
    if (Math.abs(candle.time + history.intervalSeconds - time) <
      Math.abs(history.candles[nearest].time + history.intervalSeconds - time)) nearest = index;
  });
  return nearest;
}
