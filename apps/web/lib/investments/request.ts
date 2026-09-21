import "server-only";

import { parseAssetSymbol } from "@/lib/asset-inputs";
import { InvestmentApiError } from "./errors";

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvestmentApiError("INVALID_REQUEST", 400);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new InvestmentApiError("INVALID_REQUEST", 400);
  }
  return record;
}

export function parsePrepareRequest(value: unknown): { symbol: string; amountUsd: string } {
  const input = exactObject(value, ["symbol", "amountUsd"]);
  if (typeof input.symbol !== "string" || typeof input.amountUsd !== "string" || input.amountUsd.length > 64) {
    throw new InvestmentApiError("INVALID_REQUEST", 400);
  }
  try {
    return { symbol: parseAssetSymbol(input.symbol), amountUsd: input.amountUsd };
  } catch {
    throw new InvestmentApiError("INVALID_REQUEST", 400);
  }
}

export function parseExecuteRequest(value: unknown): { signedTransaction: string; investmentToken: string } {
  const input = exactObject(value, ["signedTransaction", "investmentToken"]);
  if (
    typeof input.signedTransaction !== "string" || input.signedTransaction.length === 0 || input.signedTransaction.length > 4_096 ||
    typeof input.investmentToken !== "string" || input.investmentToken.length === 0 || input.investmentToken.length > 8_192
  ) {
    throw new InvestmentApiError("INVALID_REQUEST", 400);
  }
  return { signedTransaction: input.signedTransaction, investmentToken: input.investmentToken };
}
