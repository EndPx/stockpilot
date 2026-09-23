import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { authErrorResponse, jsonResponse, setSessionCookie } from "@/lib/auth/http";
import { enforceRateLimit, trustedClientIp } from "@/lib/auth/rate-limit";
import { createAuthSession, encodeAuthSession, registerAuthSession, toPublicSession } from "@/lib/auth/session";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";
import { isPrivyMode } from "@/lib/privy/config";
import { PrivyVerificationError, PrivyWalletPendingError, verifyPrivyWallet, type VerifiedPrivyWallet } from "@/lib/privy/server";

export function createPrivyAuthPost(
  verify: (token: string) => Promise<VerifiedPrivyWallet> = verifyPrivyWallet,
  securityStore?: AuthSecurityStore,
) {
return async function POST(request: Request): Promise<Response> {
  try {
    if (!isPrivyMode()) throw new AuthError("AUTH_DISABLED", 503);
    const config = getAuthRuntimeConfig();
    assertSameOrigin(request, config.appUrl);
    const store = securityStore ?? getAuthSecurityStore(config);
    await enforceRateLimit(store, "ip:privy-login", trustedClientIp(request, config), 20);
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) throw new AuthError("AUTH_REQUEST_INVALID", 401);
    const verified = await verify(authorization.slice(7));
    if (!verified.userId || !Number.isFinite(verified.tokenExpiresAt) || verified.tokenExpiresAt <= Date.now() + 5_000) {
      throw new AuthError("AUTH_REQUEST_INVALID", 401);
    }
    await enforceRateLimit(store, "privy-user:login", verified.userId, 15);
    const session = createAuthSession(verified.walletAddress, Date.now(), verified.userId, verified.tokenExpiresAt);
    const token = await encodeAuthSession(session, config.sessionSecret);
    await registerAuthSession(session, config, store);
    const headers = new Headers();
    setSessionCookie(headers, token, config, Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1_000)));
    return jsonResponse(toPublicSession(session), { headers });
  } catch (error) {
    if (error instanceof PrivyWalletPendingError) return authErrorResponse(new AuthError("AUTH_WALLET_PENDING", 503));
    if (error instanceof PrivyVerificationError) return authErrorResponse(new AuthError("AUTH_REQUEST_INVALID", 401));
    if (!(error instanceof AuthError)) return authErrorResponse(new AuthError("AUTH_UNAVAILABLE", 503));
    return authErrorResponse(error);
  }
};
}

export const POST = createPrivyAuthPost();
