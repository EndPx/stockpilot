import "server-only";

import { InvestmentService } from "@stockpilot/core/investments";
import { JupiterV2Adapter } from "@stockpilot/integrations/jupiter-v2";
import { assetService } from "@/lib/assets";
import { getPortfolio } from "@/lib/portfolio";
import { createSolanaReadAdapter } from "@/lib/solana/read-adapter";
import { assertFreshPreStocksSymbol } from "./trade-asset";

const solana = createSolanaReadAdapter();
let cachedKey: string | null | undefined;
let cachedJupiter: JupiterV2Adapter | undefined;
let cachedInvestment: InvestmentService | undefined;

function jupiter(): JupiterV2Adapter {
  // Jupiter documents a keyless tier. A server-side key is optional and raises
  // the rate limit; neither mode is authorization to submit a BUY.
  const apiKey = process.env.JUPITER_API_KEY?.trim() || null;
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

export async function prepareInvestment(input: { walletAddress: string; symbol: string; amountUsd: string }) {
  // Product review must precede the Jupiter quote and any wallet-signing UI.
  await assertFreshPreStocksSymbol(input.symbol);
  return investments().prepare(input);
}

export function executeInvestment(input: { signedTransaction: string; requestId: string; lastValidBlockHeight?: string }) {
  return jupiter().execute(input);
}

export function getInvestmentBlockHeight() {
  return solana.getCurrentBlockHeight();
}
