import "server-only";
import { InvestmentAssetRegistry, createPreStocksProvider, createXStocksProvider } from "@stockpilot/core/asset-registry";
import { XStocksPriceService } from "@stockpilot/integrations/xstocks-price";
import type { InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import { assetService } from "./assets";

const globalMarkets = globalThis as typeof globalThis & { stockpilotMarketRegistry?: InvestmentAssetRegistry; stockpilotXStocksPrices?: XStocksPriceService };
export const marketRegistry = globalMarkets.stockpilotMarketRegistry ??= new InvestmentAssetRegistry([createPreStocksProvider(assetService), createXStocksProvider()]);
const priceService = globalMarkets.stockpilotXStocksPrices ??= new XStocksPriceService();
export const listMarkets: InvestmentAssetRegistry["listPage"] = async (filter) => {
  const page = await marketRegistry.listPage(filter);
  const prices = await priceService.getPrices(page.assets.filter((asset) => asset.provider === "xstocks").map((asset) => asset.symbol));
  return { ...page, assets: page.assets.map((asset) => {
    const quote = asset.provider === "xstocks" ? prices.get(asset.symbol)?.quote : null;
    return quote == null ? asset : { ...asset, tokenPriceUsd: quote };
  }) };
};
export async function getPublicMarket(mint: string) {
  const snapshot = await marketRegistry.getSnapshot("xstocks");
  const asset = snapshot.assets.find((entry) => entry.id === `xstocks:${mint}`) ?? null;
  const price = asset ? (await priceService.getPrices([asset.symbol])).get(asset.symbol) ?? null : null;
  return { asset: asset && price?.quote != null ? { ...asset, tokenPriceUsd: price.quote } : asset, price, sources: snapshot.sources, stale: snapshot.stale };
}

/** Only resolve issuer quotes for canonical xStocks actually held by the wallet. */
export async function getHeldXStockPrices(assets: readonly InvestmentAsset[]) {
  const held = assets.filter((asset) => asset.provider === "xstocks");
  const result = new Map<string, { quote: number | null; fetchedAt: string | null; stale: boolean }>();
  for (let start = 0; start < held.length; start += 100) {
    const batch = held.slice(start, start + 100);
    const prices = await priceService.getPrices(batch.map((asset) => asset.symbol));
    for (const asset of batch) {
      const price = prices.get(asset.symbol);
      result.set(asset.mintAddress, price ?? { quote: null, fetchedAt: null, stale: true });
    }
  }
  return result;
}
