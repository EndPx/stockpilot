import "server-only";
import { InvestmentAssetRegistry, createPreStocksProvider, createXStocksProvider } from "@stockpilot/core/asset-registry";
import { assetService } from "./assets";

const globalMarkets = globalThis as typeof globalThis & { stockpilotMarketRegistry?: InvestmentAssetRegistry };
export const marketRegistry = globalMarkets.stockpilotMarketRegistry ??= new InvestmentAssetRegistry([createPreStocksProvider(assetService), createXStocksProvider()]);
export const listMarkets: InvestmentAssetRegistry["listPage"] = (filter) => marketRegistry.listPage(filter);
export async function getPublicMarket(mint: string) {
  const snapshot = await marketRegistry.getSnapshot("xstocks");
  return { asset: snapshot.assets.find((asset) => asset.id === `xstocks:${mint}`) ?? null, sources: snapshot.sources, stale: snapshot.stale };
}
