import {
  assertAssetIdentity,
  isSupportedClassification,
  type AssetProvider,
  type InvestmentAsset,
  type MarketClassification,
  type MarketType,
} from "@stockpilot/integrations/asset-domain";
import { AssetService } from "./assets.js";
import { XStocksService } from "@stockpilot/integrations/xstocks";

export type { InvestmentAsset, MarketType, AssetProvider, AssetAvailability, ExecutionStatus } from "@stockpilot/integrations/asset-domain";

export type ProviderSnapshot = { assets: InvestmentAsset[]; fetchedAt: string; stale: boolean };
export type AssetRegistryProvider = MarketClassification & { getSnapshot(): Promise<ProviderSnapshot> };
export type RegistryFilter = { query?: string; marketType?: MarketType; provider?: AssetProvider };
export type RegistryPageFilter = RegistryFilter & { group?: "all" | "private" | "public"; limit?: number; cursor?: string };
export class RegistryQueryError extends Error {}

/** Server-owned adapter. The legacy execution path continues to use AssetService. */
export function createPreStocksProvider(service = new AssetService()): AssetRegistryProvider {
  return { provider: "prestocks", marketType: "PRE_IPO", getSnapshot: () => service.getSnapshot() };
}

export function createXStocksProvider(service = new XStocksService()): AssetRegistryProvider {
  return { provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT", getSnapshot: () => service.getSnapshot() };
}

export class InvestmentAssetRegistry {
  private readonly providers: readonly AssetRegistryProvider[];

  /** Only trusted, server-registered issuer adapters belong here; never request payloads. */
  constructor(providers: readonly AssetRegistryProvider[] = [createPreStocksProvider()]) {
    const seen = new Set<string>();
    this.providers = providers.map((adapter) => {
      if (!isSupportedClassification(adapter)) throw new Error("Unsupported registry provider classification.");
      if (seen.has(adapter.provider)) throw new Error("Duplicate registry provider.");
      seen.add(adapter.provider);
      return { ...adapter, getSnapshot: adapter.getSnapshot.bind(adapter) };
    });
  }

  async getSnapshot(provider?: AssetProvider) {
    const snapshots = await Promise.all(this.providers.filter((adapter) => !provider || adapter.provider === provider).map(async (adapter) => {
      const snapshot = await adapter.getSnapshot();
      if (!Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error("Invalid provider freshness metadata.");
      for (const asset of snapshot.assets) {
        assertAssetIdentity(asset);
        if (asset.provider !== adapter.provider) {
          throw new Error("Asset does not belong to its registered provider.");
        }
      }
      return { ...snapshot, provider: adapter.provider };
    }));
    const assets = snapshots.flatMap(({ assets }) => assets);
    const ids = new Set<string>();
    const mints = new Set<string>();
    for (const asset of assets) {
      if (ids.has(asset.id) || mints.has(asset.mintAddress)) throw new Error("Ambiguous canonical asset registry.");
      ids.add(asset.id);
      mints.add(asset.mintAddress);
    }
    return structuredClone({
      assets,
      sources: snapshots.map(({ provider, fetchedAt, stale }) => ({ provider, fetchedAt, stale })),
      stale: snapshots.some(({ stale }) => stale),
    });
  }

  async listAssets(filter: RegistryFilter = {}): Promise<InvestmentAsset[]> {
    const needle = filter.query?.trim().toLowerCase() ?? "";
    return (await this.getSnapshot()).assets.filter((asset) =>
      (!filter.marketType || asset.marketType === filter.marketType) &&
      (!filter.provider || asset.provider === filter.provider) &&
      [asset.id, asset.symbol, asset.name, asset.description ?? ""].some((value) => value.toLowerCase().includes(needle)),
    );
  }

  /** Bounded deterministic keyset discovery contract, suitable for future agent tools. */
  async listPage(filter: RegistryPageFilter = {}) {
    const query = filter.query?.trim().toLowerCase() ?? "";
    const group = filter.group ?? "all";
    const limit = filter.limit ?? 30;
    if (query.length > 100 || !["all", "private", "public"].includes(group) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        filter.provider && !["prestocks", "xstocks"].includes(filter.provider) ||
        filter.marketType && !["PRE_IPO", "PUBLIC_EQUITY", "ETF", "PUBLIC_MARKET_PRODUCT"].includes(filter.marketType)) throw new RegistryQueryError("Invalid registry filter.");
    const groupProvider = group === "private" ? "prestocks" : group === "public" ? "xstocks" : undefined;
    if (groupProvider && filter.provider && groupProvider !== filter.provider) throw new RegistryQueryError("Conflicting provider filter.");
    const provider = filter.provider ?? groupProvider;
    const binding = JSON.stringify([query, group, provider ?? null, filter.marketType ?? null]);
    let after: string | null = null;
    if (filter.cursor) {
      try {
        if (filter.cursor.length > 1600 || !/^[A-Za-z0-9_-]+$/.test(filter.cursor)) throw new Error();
        const cursor = JSON.parse(Buffer.from(filter.cursor, "base64url").toString("utf8"));
        if (cursor.v !== 1 || cursor.binding !== binding || typeof cursor.after !== "string") throw new Error();
        after = cursor.after;
      } catch { throw new RegistryQueryError("Invalid or mismatched cursor."); }
    }
    const snapshot = await this.getSnapshot(provider);
    const matched = snapshot.assets.filter((asset) => (!filter.marketType || asset.marketType === filter.marketType) &&
      [asset.id, asset.symbol, asset.name, asset.provider, asset.description ?? "", asset.metadata?.underlyingSymbol ?? "", asset.metadata?.underlyingIsin ?? ""].some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (after && !matched.some(({ id }) => id === after)) throw new RegistryQueryError("Catalog changed; restart pagination.");
    const start = after ? matched.findIndex(({ id }) => id === after) + 1 : 0;
    const assets = matched.slice(start, start + limit);
    const nextCursor = start + assets.length < matched.length ? Buffer.from(JSON.stringify({ v: 1, binding, after: assets.at(-1)!.id })).toString("base64url") : null;
    return { assets, total: matched.length, catalogTotal: snapshot.assets.length, offset: start, nextCursor, sources: snapshot.sources, stale: snapshot.stale };
  }

  async getAssetById(assetId: string): Promise<InvestmentAsset | null> {
    return (await this.getSnapshot()).assets.find(({ id }) => id === assetId) ?? null;
  }

  async getAssetByMint(mint: string): Promise<InvestmentAsset | null> {
    return (await this.getSnapshot()).assets.find(({ mintAddress }) => mintAddress === mint) ?? null;
  }

  /** Registry eligibility only. A positive result is NOT grant, legal, quote or signing authorization. */
  async verifyAssetEligibility(assetId: string): Promise<{ eligible: boolean; reason: string }> {
    const snapshot = await this.getSnapshot();
    const asset = snapshot.assets.find(({ id }) => id === assetId);
    if (!asset) return { eligible: false, reason: "UNREGISTERED_ASSET" };
    if (snapshot.sources.find(({ provider }) => provider === asset.provider)?.stale) {
      return { eligible: false, reason: "STALE_REGISTRY" };
    }
    if (asset.availability?.status !== "AVAILABLE" || !asset.availability.restrictionsComplete) {
      return { eligible: false, reason: "AVAILABILITY_REVIEW_REQUIRED" };
    }
    return { eligible: true, reason: "CANONICAL_ASSET_AVAILABLE" };
  }
}
