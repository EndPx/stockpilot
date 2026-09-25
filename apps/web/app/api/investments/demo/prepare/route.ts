import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { assertNoUnresolvedManualExecution } from "@/lib/control-plane/manual-executions";
import { createInvestmentAuthorization } from "@/lib/investments/authorization";
import { assertInvestmentsEnabled } from "@/lib/investments/config";
import { parseDemoTradeRequest, prepareDemoTrade } from "@/lib/investments/demo-trade";
import { InvestmentApiError, investmentErrorResponse } from "@/lib/investments/errors";
import { readInvestmentSessionIdentity } from "@/lib/investments/session";

export const dynamic = "force-dynamic";

type Dependencies = {
  readIdentity: typeof readInvestmentSessionIdentity;
  checkUnresolved: typeof assertNoUnresolvedManualExecution;
  prepare: typeof prepareDemoTrade;
  authorize: typeof createInvestmentAuthorization;
};

const defaults: Dependencies = {
  readIdentity: readInvestmentSessionIdentity,
  checkUnresolved: assertNoUnresolvedManualExecution,
  prepare: prepareDemoTrade,
  authorize: createInvestmentAuthorization,
};

export function createDemoPreparePost(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async function POST(request: Request): Promise<Response> {
    try {
      assertInvestmentsEnabled();
      const config = getAuthRuntimeConfig();
      assertSameOrigin(request, config.appUrl);
      const identity = await deps.readIdentity(request, config);
      if (identity.authProvider !== "privy" || !identity.privyUserId) {
        throw new InvestmentApiError("UNAUTHENTICATED", 401);
      }
      const body = parseDemoTradeRequest(await readJsonBody(request));
      await deps.checkUnresolved({ accountId: identity.privyUserId, walletAddress: identity.walletAddress });
      const { prepared, review } = await deps.prepare(identity.walletAddress, identity.privyUserId, body);
      const token = await deps.authorize({
        side: body.side, provider: body.provider, walletAddress: identity.walletAddress,
        requestId: prepared.requestId, inputMint: review.inputMint, outputMint: review.outputMint,
        inputAmountRaw: review.inputAmountRaw, inputDecimals: body.side === "BUY" ? 6 :
          "inputDecimals" in prepared ? prepared.inputDecimals : 6,
        outputDecimals: body.side === "SELL" ? 6 :
          "outputDecimals" in prepared ? prepared.outputDecimals : 6,
        requiredMinimumOutputRaw: review.requiredMinimumOutputRaw,
        maximumWalletNativeDebitLamportsRaw: review.maximumWalletNativeDebitLamportsRaw,
        symbol: review.symbol, lastValidBlockHeight: prepared.lastValidBlockHeight,
        orderExpireAt: review.expiresAt, transaction: prepared.transaction,
      }, config.sessionSecret);
      return jsonResponse({ review, transaction: prepared.transaction, investmentToken: token });
    } catch (error) {
      return investmentErrorResponse(error);
    }
  };
}

export const POST = createDemoPreparePost();
