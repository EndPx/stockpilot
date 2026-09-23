import { createAuthChallenge, encodeAuthChallenge, normalizeWalletAddress } from "@/lib/auth/challenge";
import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { authErrorResponse, jsonResponse, readJsonBody, setChallengeCookie } from "@/lib/auth/http";
import { enforceRateLimit, limitAuthIp, trustedClientIp } from "@/lib/auth/rate-limit";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";
import { isPrivyMode } from "@/lib/privy/config";
import { AuthError } from "@/lib/auth/errors";

export function createAuthChallengePost(securityStore?: AuthSecurityStore) {
return async function POST(request: Request): Promise<Response> {
  try {
    if (isPrivyMode()) throw new AuthError("AUTH_DISABLED", 503);
    const config = getAuthRuntimeConfig();
    assertSameOrigin(request, config.appUrl);
    const store = securityStore ?? getAuthSecurityStore(config);
    await limitAuthIp(store, request, config, "challenge");
    const body = await readJsonBody(request) as { walletAddress?: unknown };
    const walletAddress = normalizeWalletAddress(body?.walletAddress);
    await enforceRateLimit(store, "ip-wallet:challenge", `${trustedClientIp(request, config)}:${walletAddress}`, 10);
    const challenge = createAuthChallenge(walletAddress, config);
    const token = await encodeAuthChallenge(challenge, config.sessionSecret);
    await store.registerChallenge(challenge.input.requestId, challenge.expiresAt);
    const headers = new Headers();
    setChallengeCookie(headers, token, config);
    return jsonResponse({ input: challenge.input }, { headers });
  } catch (error) {
    return authErrorResponse(error);
  }
};
}

export const POST = createAuthChallengePost();
