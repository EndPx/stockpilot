import { fetchPreStocks, type Asset } from "@stockpilot/integrations/prestocks";

export type { Asset } from "@stockpilot/integrations/prestocks";

export type AssetSnapshot = {
  assets: Asset[];
  fetchedAt: string;
  stale: boolean;
};

const FRESH_MS = 45_000;
const MAX_STALE_AGE_MS = 5 * 60_000;

export class AssetService {
  private cache: { assets: Asset[]; fetchedAt: number } | undefined;
  private pending: Promise<AssetSnapshot> | undefined;

  constructor(
    private readonly load: () => Promise<Asset[]> = fetchPreStocks,
    private readonly now: () => number = Date.now,
  ) {}

  /** Request-scoped freshness metadata; stale fallback never extends the cache's age. */
  async getSnapshot(): Promise<AssetSnapshot> {
    if (this.cache && this.now() - this.cache.fetchedAt < FRESH_MS) {
      return this.snapshot(false);
    }
    if (!this.pending) {
      this.pending = this.refresh().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  private snapshot(stale: boolean): AssetSnapshot {
    const cache = this.cache!;
    // Callers cannot mutate the shared cache through returned objects.
    return { assets: cache.assets.map((asset) => ({ ...asset })), fetchedAt: new Date(cache.fetchedAt).toISOString(), stale };
  }

  private async refresh(): Promise<AssetSnapshot> {
    try {
      const assets = await this.load();
      this.cache = { assets, fetchedAt: this.now() };
      return this.snapshot(false);
    } catch (error) {
      if (this.cache && this.now() - this.cache.fetchedAt < MAX_STALE_AGE_MS) {
        return this.snapshot(true);
      }
      throw error;
    }
  }

  async listAssets(query?: string): Promise<Asset[]> {
    return searchAssets((await this.getSnapshot()).assets, query);
  }

  async getAssetBySymbol(symbol: string): Promise<Asset | null> {
    return findAssetBySymbol((await this.getSnapshot()).assets, symbol);
  }

  async getAssetByMint(mint: string): Promise<Asset | null> {
    return (await this.getSnapshot()).assets.find((asset) => asset.mintAddress === mint) ?? null;
  }
}

export function searchAssets(assets: Asset[], query = ""): Asset[] {
  const needle = query.trim().toLowerCase();
  return assets.filter((asset) => [asset.symbol, asset.name, asset.description ?? ""].some((value) => value.toLowerCase().includes(needle)));
}

export function findAssetBySymbol(assets: Asset[], symbol: string): Asset | null {
  const matches = assets.filter((asset) => asset.symbol.toLowerCase() === symbol.toLowerCase());
  if (matches.length > 1) throw new Error("PreStocks registry contains an ambiguous symbol.");
  return matches[0] ?? null;
}
