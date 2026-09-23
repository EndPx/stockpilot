import { readProviderJson } from "@stockpilot/integrations/provider-json";
import { XSTOCKS_API } from "@stockpilot/integrations/xstocks";

export type XStockPrice = { quote: number | null; fetchedAt: string; stale: boolean };
type CachedPrice = { quote: number | null; fetchedAt: number };

/** The issuer's public indicative token quote, never a trade or execution price. */
export async function fetchXStockPrice(symbol: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(symbol)) throw new Error("Invalid xStocks symbol.");
  const response = await fetcher(`${XSTOCKS_API}/${encodeURIComponent(symbol)}/price-data`, {
    headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error("xStocks price unavailable.");
  const payload = await readProviderJson(response, 4_096);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("quote" in payload)) throw new Error("Invalid xStocks price response.");
  const quote = payload.quote;
  if (quote !== null && (typeof quote !== "number" || !Number.isFinite(quote) || quote <= 0)) throw new Error("Invalid xStocks quote.");
  return quote;
}

/** Process-local, bounded, single-flight cache shared by catalog and detail reads. */
export class XStocksPriceService {
  private readonly cache = new Map<string, CachedPrice>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly retryAt = new Map<string, number>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly load: (symbol: string) => Promise<number | null> = fetchXStockPrice,
    private readonly now = Date.now,
    private readonly maxConcurrent = 6,
    private readonly batchWaitMs = 5_000,
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 20) throw new Error("Invalid price concurrency.");
  }

  private snapshot(symbol: string): XStockPrice | null {
    const cached = this.cache.get(symbol);
    if (!cached || this.now() - cached.fetchedAt >= 600_000) return null;
    return { quote: cached.quote, fetchedAt: new Date(cached.fetchedAt).toISOString(), stale: this.now() - cached.fetchedAt >= 60_000 };
  }

  private async refresh(symbol: string): Promise<void> {
    if (this.active >= this.maxConcurrent) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const quote = await this.load(symbol);
      this.cache.set(symbol, { quote, fetchedAt: this.now() });
      this.retryAt.delete(symbol);
      // The official catalog is capped at 3,000 products; keep this cache bounded too.
      if (this.cache.size > 3_000) this.cache.delete(this.cache.keys().next().value!);
    } catch {
      this.retryAt.set(symbol, this.now() + 30_000);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private read(symbol: string): Promise<void> {
    const cached = this.snapshot(symbol);
    if (cached && !cached.stale) return Promise.resolve();
    if ((this.retryAt.get(symbol) ?? 0) > this.now()) return Promise.resolve();
    let pending = this.pending.get(symbol);
    if (!pending) {
      pending = this.refresh(symbol).finally(() => { this.pending.delete(symbol); });
      this.pending.set(symbol, pending);
    }
    // Stale prices are served immediately while one background refresh runs.
    return cached ? Promise.resolve() : pending;
  }

  async getPrices(symbols: readonly string[]): Promise<Map<string, XStockPrice>> {
    const unique = [...new Set(symbols)];
    if (unique.length > 100) throw new Error("Price batch exceeds catalog page limit.");
    const reads = Promise.all(unique.map((symbol) => this.read(symbol)));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([reads, new Promise<void>((resolve) => { timeout = setTimeout(resolve, this.batchWaitMs); })]);
    } finally { if (timeout) clearTimeout(timeout); }
    const result = new Map<string, XStockPrice>();
    for (const symbol of unique) {
      const price = this.snapshot(symbol);
      if (price) result.set(symbol, price);
    }
    return result;
  }
}
