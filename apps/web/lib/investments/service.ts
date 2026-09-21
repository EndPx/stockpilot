import "server-only";

import { InvestmentService } from "@stockpilot/core/investments";
import { JupiterV2Adapter } from "@stockpilot/integrations/jupiter-v2";
import { assetService } from "@/lib/assets";
import { getPortfolio } from "@/lib/portfolio";
import { createSolanaReadAdapter } from "@/lib/solana/read-adapter";

const solana = createSolanaReadAdapter();
let cachedKey: string | undefined;
let cachedJupiter: JupiterV2Adapter | undefined;
let cachedInvestment: InvestmentService | undefined;

function jupiter(): JupiterV2Adapter {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) throw new Error("JUPITER_API_KEY is required.");
  if (!cachedJupiter || cachedKey !== apiKey) {
    cachedKey = apiKey;
    cachedJupiter = new JupiterV2Adapter(apiKey);
    cachedInvestment = undefined;
  }
  return cachedJupiter;
}

function investments(): InvestmentService {
  return cachedInvestment ??= new InvestmentService(
    assetService,
    { getPortfolio },
    solana,
    jupiter(),
  );
}

export function prepareInvestment(input: { walletAddress: string; symbol: string; amountUsd: string }) {
  return investments().prepare(input);
}

export function executeInvestment(input: { signedTransaction: string; requestId: string; lastValidBlockHeight?: string }) {
  return jupiter().execute(input);
}

export function getInvestmentBlockHeight() {
  return solana.getCurrentBlockHeight();
}
