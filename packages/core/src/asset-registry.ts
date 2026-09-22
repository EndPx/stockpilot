import {
  assertAssetIdentity,
  isSupportedClassification,
  type AssetProvider,
  type InvestmentAsset,
  type MarketClassification,
  type MarketType,
} from "@stockpilot/integrations/asset-domain";
import { AssetService } from "./assets.js";

export type { InvestmentAsset, MarketType, AssetProvider, AssetAvailability } from "@stockpilot/integrations/asset-domain";

export type ProviderSnapshot = { assets: InvestmentAsset[]; fetchedAt: string; stale: boolean };
export type AssetRegistryProvider = MarketClassification & { getSnapshot(): Promise<ProviderSnapshot> };
export type RegistryFilter = { query?: string; marketType?: MarketType; provider?: AssetProvider };

/** Server-owned adapter. The legacy execution path continues to use AssetService. */
export function createPreStocksProvider(service = new AssetService()): AssetRegistryProvider {
  return { provider: "prestocks", marketType: "PRE_IPO", getSnapshot: () => service.getSnapshot() };
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

  async getSnapshot() {
    const snapshots = await Promise.all(this.providers.map(async (adapter) => {
      const snapshot = await adapter.getSnapshot();
      if (!Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error("Invalid provider freshness metadata.");
      for (const asset of snapshot.assets) {
        assertAssetIdentity(asset);
        if (asset.provider !== adapter.provider || asset.marketType !== adapter.marketType) {
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
