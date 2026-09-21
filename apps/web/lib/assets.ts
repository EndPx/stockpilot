import "server-only";
import { AssetService, findAssetBySymbol, searchAssets } from "@stockpilot/core/assets";

// Cache is per server process. Keep the same instance across development reloads.
const globalAssets = globalThis as typeof globalThis & { stockpilotAssets?: AssetService };
export const assetService = globalAssets.stockpilotAssets ??= new AssetService();

export async function listAssets(query = "") {
  const { assets, ...meta } = await assetService.getSnapshot();
  return { assets: searchAssets(assets, query), total: assets.length, meta };
}

export async function getAsset(symbol: string) {
  const { assets, ...meta } = await assetService.getSnapshot();
  return { asset: findAssetBySymbol(assets, symbol), meta };
}
