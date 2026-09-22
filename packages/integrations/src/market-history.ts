import { isAddress } from "@solana/kit";
import { readProviderJson } from "@stockpilot/integrations/provider-json";
import type { MarketHistory, MarketHistoryCandle, MarketHistoryRange } from "@stockpilot/integrations/market-history-types";

const API = "https://api.geckoterminal.com/api/v2";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MIN_PRICE = 1e-15;
const MAX_PRICE = 1e15;
const RANGES = {
  "1d": { timeframe: "minute", aggregate: 15, interval: 900, count: 96 },
  "1w": { timeframe: "hour", aggregate: 1, interval: 3_600, count: 168 },
  "1m": { timeframe: "hour", aggregate: 4, interval: 14_400, count: 180 },
} as const;

export class MarketHistoryError extends Error {
  readonly code = "MARKET_HISTORY_UNAVAILABLE";
  constructor(readonly retryAfterSeconds?: number) {
    super("Market history is temporarily unavailable.");
    this.name = "MarketHistoryError";
  }
}

type Pool = { address: string; base: string; quote: string; liquidity: number; volume24h: number };
type Options = { fetch?: typeof fetch; now?: () => number };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MarketHistoryError();
  return value as Record<string, unknown>;
}

function tokenAddress(value: unknown): string {
  const data = record(record(value).data);
  if (data.type !== "token" || typeof data.id !== "string" || !data.id.startsWith("solana_")) throw new MarketHistoryError();
  const mint = data.id.slice("solana_".length);
  if (!isAddress(mint)) throw new MarketHistoryError();
  return mint;
}

function selectPool(payload: unknown, mint: string): Pool | null {
  const { data } = record(payload);
  if (!Array.isArray(data) || data.length > 20) throw new MarketHistoryError();
  const eligible: Pool[] = [];
  for (const value of data) {
    const pool = record(value);
    const attributes = record(pool.attributes);
    const relationships = record(pool.relationships);
    const base = tokenAddress(relationships.base_token);
    const quote = tokenAddress(relationships.quote_token);
    const poolAddress = attributes.address;
    if (pool.type !== "pool" || typeof poolAddress !== "string" || !isAddress(poolAddress) || pool.id !== `solana_${poolAddress}`) {
      throw new MarketHistoryError();
    }
    const paired = base === mint ? quote : quote === mint ? base : null;
    if (paired !== USDC && paired !== WRAPPED_SOL) continue;
    const rawLiquidity = attributes.reserve_in_usd;
    if (typeof rawLiquidity !== "string" && typeof rawLiquidity !== "number") throw new MarketHistoryError();
    const liquidity = Number(rawLiquidity);
    if (!Number.isFinite(liquidity) || liquidity < 0 || rawLiquidity === "") throw new MarketHistoryError();
    const rawVolume = attributes.volume_usd == null ? null : record(attributes.volume_usd).h24;
    let volume24h = 0;
    if (rawVolume != null) {
      if ((typeof rawVolume !== "string" && typeof rawVolume !== "number") ||
        (typeof rawVolume === "string" && !rawVolume.trim())) throw new MarketHistoryError();
      volume24h = Number(rawVolume);
      if (!Number.isFinite(volume24h) || volume24h < 0 || volume24h > Number.MAX_SAFE_INTEGER) throw new MarketHistoryError();
    }
    if (liquidity > 0) eligible.push({ address: poolAddress, base, quote, liquidity, volume24h });
  }
  eligible.sort((a, b) => b.volume24h - a.volume24h || b.liquidity - a.liquidity || a.address.localeCompare(b.address));
  return eligible[0] ?? null;
}

function candle(value: unknown): MarketHistoryCandle | null {
  if (!Array.isArray(value) || value.length !== 6 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  const [time, open, high, low, close, volumeUsd] = value as number[];
  if (Math.min(open, high, low, close) < MIN_PRICE || Math.max(open, high, low, close) > MAX_PRICE ||
    volumeUsd < 0 || volumeUsd > Number.MAX_SAFE_INTEGER ||
    high < Math.max(open, low, close) || low > Math.min(open, high, close)) return null;
  return { time, open, high, low, close, volumeUsd };
}

function normalizeCandles(rows: unknown[], start: number, end: number, interval: number) {
  const byTime = new Map<number, { candle: MarketHistoryCandle | null; count: number }>();
  let omittedCandles = 0;
  for (const row of rows) {
    const time: unknown = Array.isArray(row) ? row[0] : undefined;
    if (typeof time !== "number" || !Number.isSafeInteger(time)) { omittedCandles++; continue; }
    if (time < start || time >= end) continue;
    const next = time % interval === 0 ? candle(row) : null;
    const previous = byTime.get(time);
    if (!previous) byTime.set(time, { candle: next, count: 1 });
    else {
      previous.count++;
      if (!next || !previous.candle || JSON.stringify(next) !== JSON.stringify(previous.candle)) previous.candle = null;
    }
  }
  const candles: MarketHistoryCandle[] = [];
  for (const entry of byTime.values()) {
    if (entry.candle) candles.push(entry.candle);
    else omittedCandles += entry.count;
  }
  candles.sort((a, b) => a.time - b.time);
  return { candles, omittedCandles };
}

/** Pool history is display data only; the caller must resolve an official catalog mint. */
export async function fetchMarketHistory(mint: string, range: MarketHistoryRange, options: Options = {}): Promise<MarketHistory> {
  try {
    if (!isAddress(mint) || !Object.hasOwn(RANGES, range)) throw new MarketHistoryError();
    const settings = RANGES[range];
    const now = options.now ?? Date.now;
    const startedAt = now();
    if (!Number.isFinite(startedAt) || startedAt < 0) throw new MarketHistoryError();
    const windowEnd = Math.floor(startedAt / 1000 / settings.interval) * settings.interval;
    const windowStart = windowEnd - settings.count * settings.interval;
    const result: MarketHistory = {
      mint, range, currency: "USD", priceBasis: "PROVIDER_REPORTED", intervalSeconds: settings.interval,
      windowStart, windowEnd, fetchedAt: new Date(startedAt).toISOString(),
      status: "empty", candles: [], source: null, omittedCandles: 0,
    };
    const signal = AbortSignal.timeout(10_000);
    const fetcher = options.fetch ?? fetch;
    async function read(url: URL) {
      signal.throwIfAborted();
      const response = await fetcher(url, {
        headers: { Accept: "application/json;version=20230203" },
        cache: "no-store", redirect: "error", signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new MarketHistoryError(response.status === 429 ? 60 : undefined);
      }
      const body = await readProviderJson(response, MAX_RESPONSE_BYTES);
      signal.throwIfAborted();
      return body;
    }
    const pool = selectPool(await read(new URL(`${API}/networks/solana/tokens/${mint}/pools`)), mint);
    if (!pool) return result;
    result.source = {
      name: "GeckoTerminal", poolAddress: pool.address,
      poolUrl: `https://www.geckoterminal.com/solana/pools/${pool.address}`,
    };
    const url = new URL(`${API}/networks/solana/pools/${pool.address}/ohlcv/${settings.timeframe}`);
    url.search = new URLSearchParams({
      aggregate: String(settings.aggregate), limit: String(settings.count + 2),
      currency: "usd", token: mint, include_empty_intervals: "false",
      before_timestamp: String(windowEnd - 1),
    }).toString();
    const payload = record(await read(url));
    const meta = record(payload.meta);
    if (record(meta.base).address !== pool.base || record(meta.quote).address !== pool.quote) throw new MarketHistoryError();
    const rows = record(record(payload.data).attributes).ohlcv_list;
    if (!Array.isArray(rows) || rows.length > settings.count + 2) throw new MarketHistoryError();
    const normalized = normalizeCandles(rows, windowStart, windowEnd, settings.interval);
    if (!normalized.candles.length && normalized.omittedCandles > 0) throw new MarketHistoryError();
    return { ...result, ...normalized, status: normalized.candles.length ? "available" : "empty", fetchedAt: new Date(now()).toISOString() };
  } catch (error) {
    if (error instanceof MarketHistoryError) throw error;
    throw new MarketHistoryError();
  }
}
