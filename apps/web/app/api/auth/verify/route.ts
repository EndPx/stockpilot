import { decodeAuthChallenge } from "@/lib/auth/challenge";
import { AUTH_CHALLENGE_COOKIE, assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { authErrorResponse, clearChallengeCookie, jsonResponse, readCookie, readJsonBody, setSessionCookie } from "@/lib/auth/http";
import { parseAuthVerifyRequest, verifyAuthProof } from "@/lib/auth/proof";
import { createAuthSession, encodeAuthSession, registerAuthSession, toPublicSession } from "@/lib/auth/session";
import { enforceRateLimit, limitAuthIp, trustedClientIp } from "@/lib/auth/rate-limit";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";

export function createAuthVerifyPost(securityStore?: AuthSecurityStore) {
return async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof getAuthRuntimeConfig> | undefined;
  let headers: Headers | undefined;

  try {
    config = getAuthRuntimeConfig();
    assertSameOrigin(request, config.appUrl);
    const store = securityStore ?? getAuthSecurityStore(config);
    await limitAuthIp(store, request, config, "verify");
    const body = parseAuthVerifyRequest(await readJsonBody(request));
    const challengeToken = readCookie(request, AUTH_CHALLENGE_COOKIE);
    headers = new Headers();
    clearChallengeCookie(headers, config);

    if (!challengeToken) {
      throw new AuthError("AUTH_REPLAY_DETECTED", 401);
    }

    const challenge = await decodeAuthChallenge(challengeToken, config.sessionSecret);
    if (challenge.input.domain !== config.appUrl.host || challenge.input.uri !== config.appUrl.origin) {
      throw new AuthError("AUTH_DOMAIN_MISMATCH", 401);
    }
    if (body.requestId !== challenge.input.requestId) {
      throw new AuthError("AUTH_CHALLENGE_INVALID", 401);
    }
    await enforceRateLimit(store, "ip-wallet:verify", `${trustedClientIp(request, config)}:${challenge.input.address}`, 15);
    // Burn the server-side challenge atomically before proof validation. Restoring
    // a saved browser cookie or racing two proofs cannot mint two sessions.
    if (!await store.consumeChallenge(challenge.input.requestId)) throw new AuthError("AUTH_REPLAY_DETECTED", 401);

    verifyAuthProof(challenge.input, body);
    const session = createAuthSession(challenge.input.address);
    const sessionToken = await encodeAuthSession(session, config.sessionSecret);
    await registerAuthSession(session, config, store);
    setSessionCookie(headers, sessionToken, config);
    return jsonResponse(toPublicSession(session), { headers });
  } catch (error) {
    if (config && !headers) {
      headers = new Headers();
      clearChallengeCookie(headers, config);
    }
    return authErrorResponse(error, headers);
  }
};
}

export const POST = createAuthVerifyPost();
