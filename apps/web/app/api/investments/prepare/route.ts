import type { PreparedInvestment } from "@stockpilot/core/investments";
import { formatRawTokenAmount } from "@stockpilot/core/portfolio";
import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { assertNoUnresolvedManualExecution } from "@/lib/control-plane/manual-executions";
import {
  createInvestmentAuthorization,
  INVESTMENT_TOKEN_TTL_MS,
} from "@/lib/investments/authorization";
import { InvestmentApiError, investmentErrorResponse } from "@/lib/investments/errors";
import { assertInvestmentsEnabled } from "@/lib/investments/config";
import { parsePrepareRequest } from "@/lib/investments/request";
import { prepareInvestment } from "@/lib/investments/service";
import { readInvestmentSessionIdentity } from "@/lib/investments/session";
import { assertCurrentInvestorEligibility, assertFreshPreStocksSymbol } from "@/lib/investments/trade-asset";
import {
  assertPreparedInvestmentTransaction,
  createManualTradeValidationPolicy,
  type PreparedTransactionInspection,
} from "@/lib/investments/transaction-validation";
import type { PreparedInvestmentResponse } from "@/lib/investments/types";

export const dynamic = "force-dynamic";

type Dependencies = {
  checkAsset: typeof assertFreshPreStocksSymbol;
  checkInvestor: typeof assertCurrentInvestorEligibility;
  checkUnresolved: typeof assertNoUnresolvedManualExecution;
  prepare: typeof prepareInvestment;
  validatePrepared: (prepared: PreparedInvestment) => Promise<NonNullable<PreparedTransactionInspection["effects"]>>;
  authorize: (prepared: PreparedInvestment, effects: NonNullable<PreparedTransactionInspection["effects"]>, secret: string, now: number) => Promise<string>;
  now: () => number;
};

const defaults: Dependencies = {
  checkAsset: assertFreshPreStocksSymbol,
  checkInvestor: assertCurrentInvestorEligibility,
  checkUnresolved: assertNoUnresolvedManualExecution,
  prepare: prepareInvestment,
  async validatePrepared(prepared) {
    const inspection = await assertPreparedInvestmentTransaction(prepared, createManualTradeValidationPolicy(prepared));
    if (!inspection.effects) throw new Error("Investment transaction effect proof is unavailable.");
    return inspection.effects;
  },
  now: Date.now,
  authorize(prepared, effects, secret, now) {
    return createInvestmentAuthorization({
      side: "BUY",
      provider: "prestocks",
      walletAddress: prepared.walletAddress,
      requestId: prepared.requestId,
      inputMint: prepared.fundingAsset.mintAddress,
      outputMint: prepared.asset.mintAddress,
      inputAmountRaw: prepared.inputAmountRaw,
      requiredMinimumOutputRaw: effects.requiredMinimumOutputRaw,
      maximumWalletNativeDebitLamportsRaw: effects.maximumWalletNativeDebitLamportsRaw,
      inputDecimals: 6,
      outputDecimals: prepared.outputDecimals,
      symbol: prepared.asset.symbol,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
      orderExpireAt: prepared.expireAt,
      transaction: prepared.transaction,
    }, secret, now);
  },
};

function reviewExpiry(prepared: PreparedInvestment, now: number): string {
  const tokenExpiry = now + INVESTMENT_TOKEN_TTL_MS;
  if (!prepared.expireAt) return new Date(tokenExpiry).toISOString();
  const orderExpiry = Date.parse(prepared.expireAt);
  return new Date(Math.min(tokenExpiry, orderExpiry)).toISOString();
}

export function createInvestmentPreparePost(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return async function POST(request: Request): Promise<Response> {
    try {
      assertInvestmentsEnabled();
      const config = getAuthRuntimeConfig();
      assertSameOrigin(request, config.appUrl);
      const identity = await readInvestmentSessionIdentity(request, config);
      if (identity.authProvider !== "privy" || !identity.privyUserId) {
        throw new InvestmentApiError("UNAUTHENTICATED", 401);
      }
      const body = parsePrepareRequest(await readJsonBody(request));
      await deps.checkUnresolved({ accountId: identity.privyUserId, walletAddress: identity.walletAddress });
      const mintAddress = await deps.checkAsset(body.symbol);
      await deps.checkInvestor({ accountId: identity.privyUserId,
        walletAddress: identity.walletAddress, provider: "prestocks", side: "BUY", mintAddress });
      const prepared = await deps.prepare({ ...body, walletAddress: identity.walletAddress });
      if (prepared.walletAddress !== identity.walletAddress || prepared.asset.mintAddress !== mintAddress ||
          prepared.asset.symbol.toLowerCase() !== body.symbol.toLowerCase()) {
        throw new InvestmentApiError("ASSET_NOT_ALLOWED", 409,
          "The issuer product changed while preparing this review. Try again.");
      }
      const effects = await deps.validatePrepared(prepared);
      const now = deps.now();
      const response: PreparedInvestmentResponse = {
        investment: {
          providerRequestId: prepared.requestId,
          walletAddress: prepared.walletAddress,
          asset: prepared.asset,
          fundingAsset: prepared.fundingAsset,
          inputAmountRaw: prepared.inputAmountRaw,
          inputAmountUsd: prepared.inputAmountUsd,
          outputAmountRaw: prepared.outputAmountRaw,
          estimatedOutputAmount: formatRawTokenAmount(prepared.outputAmountRaw, prepared.outputDecimals),
          requiredMinimumOutputRaw: effects.requiredMinimumOutputRaw,
          minimumOutputAmount: formatRawTokenAmount(effects.requiredMinimumOutputRaw, prepared.outputDecimals),
          maximumWalletNativeDebitLamportsRaw: effects.maximumWalletNativeDebitLamportsRaw,
          router: prepared.router,
          mode: prepared.mode,
          feeBps: prepared.feeBps,
          feeMint: prepared.feeMint,
          priceImpactPct: prepared.priceImpactPct,
          expiresAt: reviewExpiry(prepared, now),
        },
        transaction: prepared.transaction,
        investmentToken: await deps.authorize(prepared, effects, config.sessionSecret, now),
      };
      return jsonResponse(response);
    } catch (error) {
      return investmentErrorResponse(error);
    }
  };
}

export const POST = createInvestmentPreparePost();
