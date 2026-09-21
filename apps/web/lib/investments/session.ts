import "server-only";

import type { AuthRuntimeConfig } from "@/lib/auth/config";
import { AUTH_SESSION_COOKIE } from "@/lib/auth/config";
import { readCookie } from "@/lib/auth/http";
import { decodeAuthSession } from "@/lib/auth/session";
import { InvestmentApiError } from "./errors";

export async function readInvestmentSessionWallet(request: Request, config: AuthRuntimeConfig): Promise<string> {
  const token = readCookie(request, AUTH_SESSION_COOKIE);
  if (!token) throw new InvestmentApiError("UNAUTHENTICATED", 401);
  try {
    return (await decodeAuthSession(token, config.sessionSecret)).walletAddress;
  } catch {
    throw new InvestmentApiError("UNAUTHENTICATED", 401);
  }
}
