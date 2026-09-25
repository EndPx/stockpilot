import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { assertAuthorizationWallet, readInvestmentAuthorization } from "@/lib/investments/authorization";
import { InvestmentApiError, investmentErrorResponse } from "@/lib/investments/errors";
import { assertInvestmentsEnabled } from "@/lib/investments/config";
import { parseExecuteRequest } from "@/lib/investments/request";
import { executeManualTradeOnce } from "@/lib/investments/manual-execution";
import { readInvestmentSessionIdentity } from "@/lib/investments/session";
import { assertCurrentInvestorEligibility, assertFreshTradeAsset } from "@/lib/investments/trade-asset";

export const dynamic = "force-dynamic";

type Dependencies = {
  readAuthorization: typeof readInvestmentAuthorization;
  readIdentity: typeof readInvestmentSessionIdentity;
  assertFreshAsset: typeof assertFreshTradeAsset;
  checkInvestor: typeof assertCurrentInvestorEligibility;
  executeManual: typeof executeManualTradeOnce;
};

const defaults: Dependencies = {
  readAuthorization: readInvestmentAuthorization,
  readIdentity: readInvestmentSessionIdentity,
  assertFreshAsset: assertFreshTradeAsset,
  checkInvestor: assertCurrentInvestorEligibility,
  executeManual: executeManualTradeOnce,
};

/**
 * Only a verified owner session may submit its own signed transaction. The
 * manual executor atomically claims the order before the provider call and
 * reports success only after finalized Solana evidence is reconciled.
 */
export function createInvestmentExecutePost(dependencies: Partial<Dependencies> = {}) {
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
      const body = parseExecuteRequest(await readJsonBody(request));
      const authorization = await deps.readAuthorization(body.investmentToken, config.sessionSecret);
      assertAuthorizationWallet(authorization, identity.walletAddress);
      await deps.assertFreshAsset(authorization);
      await deps.checkInvestor({ accountId: identity.privyUserId,
        walletAddress: identity.walletAddress,
        provider: authorization.provider ?? "prestocks", side: authorization.side ?? "BUY",
        mintAddress: (authorization.side ?? "BUY") === "SELL"
          ? authorization.inputMint : authorization.outputMint });
      const outcome = await deps.executeManual({
        accountId: identity.privyUserId,
        walletAddress: identity.walletAddress,
        authorization,
        signedTransaction: body.signedTransaction,
      });
      return jsonResponse({ execution: {
        status: outcome.status,
        side: authorization.side ?? "BUY",
        providerRequestId: outcome.requestId,
        transactionSignature: outcome.signature,
        actualInputAmountRaw: outcome.status === "CONFIRMED" ? outcome.actualInputAmountRaw : null,
        actualOutputAmountRaw: outcome.status === "CONFIRMED" ? outcome.actualOutputAmountRaw : null,
        solscanUrl: `https://solscan.io/tx/${encodeURIComponent(outcome.signature)}`,
      } }, { status: outcome.status === "PENDING" ? 202 : 200 });
    } catch (error) {
      return investmentErrorResponse(error);
    }
  };
}

export const POST = createInvestmentExecutePost();
