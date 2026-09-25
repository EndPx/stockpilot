import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { assertAuthorizationWallet, readInvestmentAuthorization } from "@/lib/investments/authorization";
import { assertInvestmentsEnabled } from "@/lib/investments/config";
import { demoWalletAllowed, resolveDemoAsset } from "@/lib/investments/demo-trade";
import { InvestmentApiError, investmentErrorResponse } from "@/lib/investments/errors";
import { executeManualTradeOnce } from "@/lib/investments/manual-execution";
import { parseExecuteRequest } from "@/lib/investments/request";
import { readInvestmentSessionIdentity } from "@/lib/investments/session";

export const dynamic = "force-dynamic";

type Dependencies = {
  readIdentity: typeof readInvestmentSessionIdentity;
  readAuthorization: typeof readInvestmentAuthorization;
  resolveAsset: typeof resolveDemoAsset;
  executeManual: typeof executeManualTradeOnce;
};

const defaults: Dependencies = {
  readIdentity: readInvestmentSessionIdentity,
  readAuthorization: readInvestmentAuthorization,
  resolveAsset: resolveDemoAsset,
  executeManual: executeManualTradeOnce,
};

export function createDemoExecutePost(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async function POST(request: Request): Promise<Response> {
    let submissionStarted = false;
    try {
      assertInvestmentsEnabled();
      const config = getAuthRuntimeConfig();
      assertSameOrigin(request, config.appUrl);
      const identity = await deps.readIdentity(request, config);
      if (identity.authProvider !== "privy" || !identity.privyUserId ||
          !demoWalletAllowed(identity.walletAddress)) throw new InvestmentApiError("UNAUTHENTICATED", 401);
      const body = parseExecuteRequest(await readJsonBody(request));
      const authorization = await deps.readAuthorization(body.investmentToken, config.sessionSecret);
      assertAuthorizationWallet(authorization, identity.walletAddress);
      if (!/^build:[a-f0-9]{64}$/.test(authorization.requestId) ||
          (authorization.provider !== "prestocks" && authorization.provider !== "xstocks")) {
        throw new InvestmentApiError("INVESTMENT_TOKEN_INVALID", 401);
      }
      const assetMint = authorization.side === "SELL" ? authorization.inputMint : authorization.outputMint;
      const asset = await deps.resolveAsset(authorization.provider, assetMint);
      if (asset.symbol !== authorization.symbol) throw new InvestmentApiError("ASSET_NOT_ALLOWED", 409);
      submissionStarted = true;
      const outcome = await deps.executeManual({
        accountId: identity.privyUserId, walletAddress: identity.walletAddress,
        authorization, signedTransaction: body.signedTransaction,
      });
      return jsonResponse({ execution: {
        status: outcome.status, side: authorization.side ?? "BUY",
        providerRequestId: outcome.requestId, transactionSignature: outcome.signature,
        actualInputAmountRaw: outcome.status === "CONFIRMED" ? outcome.actualInputAmountRaw : null,
        actualOutputAmountRaw: outcome.status === "CONFIRMED" ? outcome.actualOutputAmountRaw : null,
        solscanUrl: `https://solscan.io/tx/${encodeURIComponent(outcome.signature)}`,
      } }, { status: outcome.status === "PENDING" ? 202 : 200 });
    } catch (error) {
      const response = investmentErrorResponse(error);
      if (submissionStarted) return response;
      const body = await response.json();
      return jsonResponse({ ...body, error: { ...body.error, submissionStatus: "NOT_SUBMITTED" } },
        { status: response.status });
    }
  };
}

export const POST = createDemoExecutePost();
