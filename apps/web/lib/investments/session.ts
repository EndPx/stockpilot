import "server-only";

import type { AuthRuntimeConfig } from "@/lib/auth/config";
import { AUTH_SESSION_COOKIE } from "@/lib/auth/config";
import { readCookie } from "@/lib/auth/http";
import { readActiveAuthSession } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/errors";
import type { AuthSecurityStore } from "@/lib/auth/store";
import { InvestmentApiError } from "./errors";

export async function readInvestmentSessionWallet(request: Request, config: AuthRuntimeConfig, store?: AuthSecurityStore): Promise<string> {
  const token = readCookie(request, AUTH_SESSION_COOKIE);
  if (!token) throw new InvestmentApiError("UNAUTHENTICATED", 401);
  try {
    return (await readActiveAuthSession(token, config, store)).walletAddress;
  } catch (error) {
    if (error instanceof AuthError && error.status !== 401) throw error;
    throw new InvestmentApiError("UNAUTHENTICATED", 401);
  }
}
