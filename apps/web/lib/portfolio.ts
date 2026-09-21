import "server-only";

import { PortfolioService } from "@stockpilot/core/portfolio";
import { assetService } from "./assets";
import { createSolanaReadAdapter } from "./solana/read-adapter";

const globalPortfolio = globalThis as typeof globalThis & {
  stockpilotPortfolio?: PortfolioService;
};

const portfolioService = globalPortfolio.stockpilotPortfolio ??=
  new PortfolioService(assetService, createSolanaReadAdapter());

export function getPortfolio(walletAddress: string) {
  return portfolioService.getPortfolio(walletAddress);
}
