import "server-only";

import { PortfolioService } from "@stockpilot/core/portfolio";
import { getHeldXStockPrices, marketRegistry } from "./markets";
import { createSolanaReadAdapter } from "./solana/read-adapter";

const globalPortfolio = globalThis as typeof globalThis & {
  stockpilotPortfolio?: PortfolioService;
};

const portfolioService = globalPortfolio.stockpilotPortfolio ??=
  new PortfolioService({
    getSnapshot: () => marketRegistry.getSnapshot(),
    getHeldIndicativePrices: getHeldXStockPrices,
  }, createSolanaReadAdapter());

export function getPortfolio(walletAddress: string) {
  return portfolioService.getPortfolio(walletAddress);
}

export function getBalance(walletAddress: string) {
  return portfolioService.getBalance(walletAddress);
}
