import type { Portfolio } from "@stockpilot/core/portfolio";
import { PreStocksProviderError } from "@stockpilot/core/assets";
import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "@/lib/auth/config";
import { readCookie, jsonResponse } from "@/lib/auth/http";
import { decodeAuthSession } from "@/lib/auth/session";
import { getPortfolio } from "@/lib/portfolio";
import { SolanaBalanceReadError } from "@/lib/solana/read-adapter";

export const dynamic = "force-dynamic";

type PortfolioReader = (walletAddress: string) => Promise<Portfolio>;

class UnauthenticatedPortfolioError extends Error {}

async function readSessionWallet(request: Request): Promise<string> {
  const config = getAuthRuntimeConfig();
  const token = readCookie(request, AUTH_SESSION_COOKIE);
  if (!token) throw new UnauthenticatedPortfolioError();
  try {
    return (await decodeAuthSession(token, config.sessionSecret)).walletAddress;
  } catch {
    throw new UnauthenticatedPortfolioError();
  }
}

function portfolioErrorResponse(error: unknown): Response {
  if (error instanceof UnauthenticatedPortfolioError) {
    return jsonResponse({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in with your wallet to view your portfolio.",
      },
    }, { status: 401 });
  }
  if (error instanceof SolanaBalanceReadError) {
    return jsonResponse({
      error: {
        code: "SOLANA_RPC_UNAVAILABLE",
        message: "We couldn't load your wallet balances. Please try again.",
      },
    }, { status: 503 });
  }
  if (error instanceof PreStocksProviderError) {
    return jsonResponse({
      error: {
        code: "PRESTOCKS_UNAVAILABLE",
        message: "We couldn't load current PreStocks information. Please try again.",
      },
    }, { status: 503 });
  }

  console.error("[portfolio] Read failed", error instanceof Error ? error.name : "UnknownError");
  return jsonResponse({
    error: {
      code: "PORTFOLIO_UNAVAILABLE",
      message: "We couldn't load your portfolio. Please try again.",
    },
  }, { status: 503 });
}

export function createPortfolioGet(readPortfolio: PortfolioReader = getPortfolio) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const walletAddress = await readSessionWallet(request);
      return jsonResponse({ portfolio: await readPortfolio(walletAddress) });
    } catch (error) {
      return portfolioErrorResponse(error);
    }
  };
}

export const GET = createPortfolioGet();
