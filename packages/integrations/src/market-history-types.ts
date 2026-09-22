export type MarketHistoryRange = "1d" | "1w" | "1m";

export type MarketHistoryCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
};

export type MarketHistory = {
  mint: string;
  range: MarketHistoryRange;
  currency: "USD";
  priceBasis: "PROVIDER_REPORTED";
  intervalSeconds: number;
  windowStart: number;
  windowEnd: number;
  fetchedAt: string;
  status: "available" | "empty";
  candles: MarketHistoryCandle[];
  source: {
    name: "GeckoTerminal";
    poolAddress: string;
    poolUrl: string;
  } | null;
  omittedCandles: number;
};
