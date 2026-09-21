import type { JupiterExecutionResult } from "@stockpilot/integrations/jupiter-v2";
import { formatRawTokenAmount } from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_DECIMALS } from "@stockpilot/core/solana";
import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import {
  assertAuthorizationWallet,
  assertOrderStillValid,
  assertSignedInvestmentTransaction,
  readInvestmentAuthorization,
  type InvestmentAuthorization,
} from "@/lib/investments/authorization";
import { InvestmentApiError, investmentErrorResponse } from "@/lib/investments/errors";
import { parseExecuteRequest } from "@/lib/investments/request";
import { executeInvestment, getInvestmentBlockHeight } from "@/lib/investments/service";
import { readInvestmentSessionWallet } from "@/lib/investments/session";
import type { InvestmentExecutionResponse } from "@/lib/investments/types";

export const dynamic = "force-dynamic";

type Dependencies = {
  readAuthorization: typeof readInvestmentAuthorization;
  assertWallet: typeof assertAuthorizationWallet;
  assertSigned: typeof assertSignedInvestmentTransaction;
  assertValid: typeof assertOrderStillValid;
  blockHeight: typeof getInvestmentBlockHeight;
  execute: (input: { signedTransaction: string; requestId: string; lastValidBlockHeight?: string }) => Promise<JupiterExecutionResult>;
};

const defaults: Dependencies = {
  readAuthorization: readInvestmentAuthorization,
  assertWallet: assertAuthorizationWallet,
  assertSigned: assertSignedInvestmentTransaction,
  assertValid: assertOrderStillValid,
  blockHeight: getInvestmentBlockHeight,
  execute: executeInvestment,
};

function executionFailure(result: JupiterExecutionResult): never {
  if (result.code !== null && [-1, -1004, -2003].includes(result.code)) {
    throw new InvestmentApiError("JUPITER_ORDER_EXPIRED", 409);
  }
  throw new InvestmentApiError("TRANSACTION_FAILED", 422);
}

function successResponse(result: JupiterExecutionResult, authorization: InvestmentAuthorization): InvestmentExecutionResponse {
  if (
    result.status !== "Success" ||
    !result.signature ||
    result.totalInputAmount === null ||
    result.totalOutputAmount === null
  ) executionFailure(result);
  return {
    execution: {
      status: "success",
      symbol: authorization.symbol,
      signature: result.signature,
      inputAmountRaw: result.totalInputAmount,
      inputAmountUsd: formatRawTokenAmount(result.totalInputAmount, SOLANA_MAINNET_USDC_DECIMALS),
      outputAmountRaw: result.totalOutputAmount,
      outputAmount: formatRawTokenAmount(result.totalOutputAmount, authorization.outputDecimals),
      solscanUrl: `https://solscan.io/tx/${encodeURIComponent(result.signature)}`,
    },
  };
}

export function createInvestmentExecutePost(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async function POST(request: Request): Promise<Response> {
    try {
      const config = getAuthRuntimeConfig();
      assertSameOrigin(request, config.appUrl);
      const walletAddress = await readInvestmentSessionWallet(request, config);
      const body = parseExecuteRequest(await readJsonBody(request));
      const authorization = await deps.readAuthorization(body.investmentToken, config.sessionSecret);
      deps.assertWallet(authorization, walletAddress);
      const blockHeight = authorization.lastValidBlockHeight === null ? null : await deps.blockHeight();
      deps.assertValid(authorization, blockHeight);
      await deps.assertSigned(body.signedTransaction, walletAddress, authorization.messageFingerprint);
      const result = await deps.execute({
        signedTransaction: body.signedTransaction,
        requestId: authorization.requestId,
        ...(authorization.lastValidBlockHeight ? { lastValidBlockHeight: authorization.lastValidBlockHeight } : {}),
      });
      if (result.status !== "Success") executionFailure(result);
      return jsonResponse(successResponse(result, authorization));
    } catch (error) {
      return investmentErrorResponse(error);
    }
  };
}

export const POST = createInvestmentExecutePost();
