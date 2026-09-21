import "server-only";

import { InvestmentError } from "@stockpilot/core/investments";
import { PreStocksProviderError } from "@stockpilot/core/assets";
import {
  JupiterExecutionError,
  JupiterOrderError,
  JupiterOrderNotExecutableError,
} from "@stockpilot/integrations/jupiter-v2";
import { AuthError } from "@/lib/auth/errors";
import { jsonResponse } from "@/lib/auth/http";
import { SolanaBalanceReadError, SolanaInvestmentReadError } from "@/lib/solana/read-adapter";
import { InvestmentSecurityError } from "./authorization";
import type { InvestmentApiErrorBody, InvestmentApiErrorCode } from "./types";

const MESSAGES: Record<InvestmentApiErrorCode, string> = {
  UNAUTHENTICATED: "Sign in with your wallet to invest.",
  INVALID_REQUEST: "The investment request is not valid.",
  WALLET_MISMATCH: "The connected wallet does not match your authenticated session.",
  ASSET_NOT_FOUND: "This PreStocks asset was not found.",
  ASSET_NOT_ALLOWED: "Only official PreStocks assets can be purchased.",
  INVALID_AMOUNT: "Enter a valid USDC amount with no more than six decimal places.",
  INSUFFICIENT_USDC: "Your wallet does not have enough USDC for this investment.",
  JUPITER_ORDER_FAILED: "We couldn't prepare this investment with Jupiter. Please try again.",
  JUPITER_ORDER_NOT_EXECUTABLE: "Jupiter could not create an executable investment for this wallet.",
  JUPITER_ORDER_EXPIRED: "The investment quote expired. Prepare a new review.",
  INVESTMENT_TOKEN_INVALID: "This investment authorization is not valid.",
  INVESTMENT_TOKEN_EXPIRED: "This investment authorization expired. Prepare a new review.",
  TRANSACTION_MISMATCH: "The signed transaction does not match the reviewed investment.",
  JUPITER_EXECUTION_FAILED: "Jupiter could not submit this investment. No automatic retry was attempted.",
  TRANSACTION_FAILED: "The investment was not completed on Solana.",
  PROVIDER_UNAVAILABLE: "Investment services are temporarily unavailable. Please try again.",
};

export class InvestmentApiError extends Error {
  constructor(
    readonly code: InvestmentApiErrorCode,
    readonly status: number,
    message = MESSAGES[code],
  ) {
    super(message);
    this.name = "InvestmentApiError";
  }
}

function normalize(error: unknown): InvestmentApiError {
  if (error instanceof InvestmentApiError) return error;
  if (error instanceof InvestmentError) {
    const status = error.code === "ASSET_NOT_FOUND" ? 404 : error.code === "INSUFFICIENT_USDC" ? 409 : 400;
    return new InvestmentApiError(error.code, status, error.message);
  }
  if (error instanceof InvestmentSecurityError) {
    const status = error.code === "WALLET_MISMATCH" ? 403 :
      error.code === "INVESTMENT_TOKEN_INVALID" ? 401 : 409;
    return new InvestmentApiError(error.code, status, error.message);
  }
  if (error instanceof JupiterOrderNotExecutableError) {
    return new InvestmentApiError("JUPITER_ORDER_NOT_EXECUTABLE", 422);
  }
  if (error instanceof JupiterOrderError) return new InvestmentApiError("JUPITER_ORDER_FAILED", 502);
  if (error instanceof JupiterExecutionError) return new InvestmentApiError("JUPITER_EXECUTION_FAILED", 502);
  if (error instanceof AuthError) {
    return new InvestmentApiError(error.status === 401 ? "UNAUTHENTICATED" : "INVALID_REQUEST", error.status);
  }
  if (
    error instanceof PreStocksProviderError ||
    error instanceof SolanaBalanceReadError ||
    error instanceof SolanaInvestmentReadError
  ) {
    return new InvestmentApiError("PROVIDER_UNAVAILABLE", 503);
  }
  return new InvestmentApiError("PROVIDER_UNAVAILABLE", 503);
}

export function investmentErrorResponse(error: unknown): Response {
  const normalized = normalize(error);
  if (normalized.code === "PROVIDER_UNAVAILABLE" && !(error instanceof InvestmentApiError)) {
    console.error("[investment] Request failed", error instanceof Error ? error.name : "UnknownError");
  }
  const body: InvestmentApiErrorBody = {
    error: { code: normalized.code, message: normalized.message },
  };
  return jsonResponse(body, { status: normalized.status });
}
