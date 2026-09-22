import "server-only";

import { isAddress } from "@solana/kit";
import type { AssetProvider, InvestmentAssetRegistry } from "@stockpilot/core/asset-registry";
import { fetchMarketHistory } from "@stockpilot/integrations/market-history";
import type { MarketHistory, MarketHistoryRange } from "@stockpilot/integrations/market-history-types";
import { marketRegistry } from "./markets";

export type MarketHistoryQuery = { provider: AssetProvider; mint: string; range: MarketHistoryRange };
export type MarketHistoryResponse = MarketHistory & { catalogStale: boolean };

const ERRORS = {
  400: { code: "INVALID_MARKET_HISTORY_QUERY", message: "Provide one supported provider, Solana mint and history range." },
  404: { code: "MARKET_HISTORY_NOT_FOUND", message: "This asset is not in the selected official market catalog." },
  503: { code: "MARKET_HISTORY_UNAVAILABLE", message: "Market history is temporarily unavailable. Please try again later." },
} as const;

export class MarketHistoryRequestError extends Error {
  readonly code: string;
  constructor(readonly status: keyof typeof ERRORS) {
    super(ERRORS[status].message);
    this.code = ERRORS[status].code;
  }
}

export function parseMarketHistoryQuery(params: URLSearchParams): MarketHistoryQuery {
  const fields = ["provider", "mint", "range"];
  if (params.size !== fields.length || fields.some((field) => params.getAll(field).length !== 1)) {
    throw new MarketHistoryRequestError(400);
  }
  const provider = params.get("provider");
  const mint = params.get("mint");
  const range = params.get("range");
  if ((provider !== "prestocks" && provider !== "xstocks") || !mint || !isAddress(mint) ||
      (range !== "1d" && range !== "1w" && range !== "1m")) {
    throw new MarketHistoryRequestError(400);
  }
  return { provider, mint, range };
}

type CatalogReader = Pick<InvestmentAssetRegistry, "getSnapshot">;
type HistoryLoader = (mint: string, range: MarketHistoryRange) => Promise<MarketHistory>;
type CacheEntry = {
  value?: MarketHistory;
  cachedAt?: number;
  retryAt?: number;
  pending?: Promise<MarketHistory>;
};

const FRESH_MS = 5 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const FAILURE_COOLDOWN_MS = 15_000;
const MAX_SERIES = 128;
const MAX_JOBS = 2;
const CALL_WINDOW_MS = 60_000;
const MAX_CALL_CREDITS = 8;
const JOB_CALL_CREDITS = 2;

/**
 * One process-wide budget for the single-process VPS deployment. Each job
 * reserves two upstream calls until sixty seconds after it settles, including
 * empty results and failed jobs. Pending reservations never expire, so delayed
 * second calls remain covered by the rolling budget. Scaling
 * to multiple processes requires a shared limiter before enabling this endpoint.
 * Only fresh results are served; failures never turn into empty or stale success.
 */
export class MarketHistoryService {
  private readonly entries = new Map<string, CacheEntry>();
  private reservations: { expiresAt: number }[] = [];
  private activeJobs = 0;

  constructor(
    private readonly catalog: CatalogReader = marketRegistry,
    private readonly load: HistoryLoader = fetchMarketHistory,
    private readonly now: () => number = Date.now,
  ) {}

  async get(query: MarketHistoryQuery): Promise<MarketHistoryResponse> {
    let snapshot: Awaited<ReturnType<CatalogReader["getSnapshot"]>>;
    try { snapshot = await this.catalog.getSnapshot(query.provider); }
    catch { throw new MarketHistoryRequestError(503); }
    const asset = snapshot.assets.find((candidate) => candidate.provider === query.provider &&
      candidate.mintAddress === query.mint && candidate.id === `${query.provider}:${query.mint}`);
    if (!asset) throw new MarketHistoryRequestError(404);
    const history = await this.readSeries(query);
    return { ...history, catalogStale: snapshot.stale };
  }

  private async readSeries(query: MarketHistoryQuery): Promise<MarketHistory> {
    const key = `${query.provider}:${query.mint}:${query.range}`;
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (entry.value && entry.cachedAt !== undefined && now >= entry.cachedAt && now - entry.cachedAt < FRESH_MS &&
          now - Date.parse(entry.value.fetchedAt) < MAX_AGE_MS) {
        return structuredClone(entry.value);
      }
      if (entry.pending) return structuredClone(await entry.pending);
      if (entry.retryAt !== undefined && now < entry.retryAt) throw new MarketHistoryRequestError(503);
    }

    this.reservations = this.reservations.filter(({ expiresAt }) => expiresAt > now);
    if (this.activeJobs >= MAX_JOBS || (this.reservations.length + 1) * JOB_CALL_CREDITS > MAX_CALL_CREDITS) {
      throw new MarketHistoryRequestError(503);
    }
    if (!entry) {
      if (this.entries.size >= MAX_SERIES) {
        // Pin both in-flight jobs and failure cooldowns. Otherwise cache churn
        // could re-admit the same job while it is running or cooling down.
        const evictable = [...this.entries].find(([, candidate]) => !candidate.pending &&
          (candidate.retryAt === undefined || candidate.retryAt <= now));
        if (!evictable) throw new MarketHistoryRequestError(503);
        this.entries.delete(evictable[0]);
      }
      entry = {};
      this.entries.set(key, entry);
    }

    const current = entry;
    this.activeJobs++;
    const reservation = { expiresAt: Number.POSITIVE_INFINITY };
    this.reservations.push(reservation);
    current.value = undefined;
    current.cachedAt = undefined;
    current.pending = Promise.resolve().then(async () => {
      const history = await this.load(query.mint, query.range);
      const fetchedAt = Date.parse(history.fetchedAt);
      if (history.mint !== query.mint || history.range !== query.range || !Number.isFinite(fetchedAt) ||
          fetchedAt > this.now() || this.now() - fetchedAt >= MAX_AGE_MS) {
        throw new MarketHistoryRequestError(503);
      }
      current.value = structuredClone(history);
      current.cachedAt = this.now();
      current.retryAt = undefined;
      return current.value;
    }).catch(() => {
      current.retryAt = this.now() + FAILURE_COOLDOWN_MS;
      throw new MarketHistoryRequestError(503);
    }).finally(() => {
      reservation.expiresAt = this.now() + CALL_WINDOW_MS;
      this.activeJobs--;
      current.pending = undefined;
    });
    return structuredClone(await current.pending);
  }
}

const globalHistory = globalThis as typeof globalThis & { stockpilotMarketHistory?: MarketHistoryService };
const marketHistory = globalHistory.stockpilotMarketHistory ??= new MarketHistoryService();
export const getMarketHistory = (query: MarketHistoryQuery) => marketHistory.get(query);
