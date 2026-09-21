import type { PreparedInvestment } from "@stockpilot/core/investments";
import { formatRawTokenAmount } from "@stockpilot/core/portfolio";
import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import {
  createInvestmentAuthorization,
  INVESTMENT_TOKEN_TTL_MS,
} from "@/lib/investments/authorization";
import { investmentErrorResponse } from "@/lib/investments/errors";
import { parsePrepareRequest } from "@/lib/investments/request";
import { prepareInvestment } from "@/lib/investments/service";
import { readInvestmentSessionWallet } from "@/lib/investments/session";
import type { PreparedInvestmentResponse } from "@/lib/investments/types";

export const dynamic = "force-dynamic";

type Dependencies = {
  prepare: typeof prepareInvestment;
  authorize: (prepared: PreparedInvestment, secret: string, now: number) => Promise<string>;
  now: () => number;
};

const defaults: Dependencies = {
  prepare: prepareInvestment,
  now: Date.now,
  authorize(prepared, secret, now) {
    return createInvestmentAuthorization({
      walletAddress: prepared.walletAddress,
      requestId: prepared.requestId,
      inputMint: prepared.fundingAsset.mintAddress,
      outputMint: prepared.asset.mintAddress,
      inputAmountRaw: prepared.inputAmountRaw,
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
      const config = getAuthRuntimeConfig();
      assertSameOrigin(request, config.appUrl);
      const walletAddress = await readInvestmentSessionWallet(request, config);
      const body = parsePrepareRequest(await readJsonBody(request));
      const prepared = await deps.prepare({ ...body, walletAddress });
      const now = deps.now();
      const response: PreparedInvestmentResponse = {
        investment: {
          walletAddress: prepared.walletAddress,
          asset: prepared.asset,
          fundingAsset: prepared.fundingAsset,
          inputAmountRaw: prepared.inputAmountRaw,
          inputAmountUsd: prepared.inputAmountUsd,
          outputAmountRaw: prepared.outputAmountRaw,
          estimatedOutputAmount: formatRawTokenAmount(prepared.outputAmountRaw, prepared.outputDecimals),
          router: prepared.router,
          mode: prepared.mode,
          feeBps: prepared.feeBps,
          feeMint: prepared.feeMint,
          priceImpactPct: prepared.priceImpactPct,
          expiresAt: reviewExpiry(prepared, now),
        },
        transaction: prepared.transaction,
        investmentToken: await deps.authorize(prepared, config.sessionSecret, now),
      };
      return jsonResponse(response);
    } catch (error) {
      return investmentErrorResponse(error);
    }
  };
}

export const POST = createInvestmentPreparePost();
