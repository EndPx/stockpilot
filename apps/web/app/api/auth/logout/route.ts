import { AUTH_CHALLENGE_COOKIE, AUTH_SESSION_COOKIE, assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { decodeAuthChallenge } from "@/lib/auth/challenge";
import { AuthError } from "@/lib/auth/errors";
import { authErrorResponse, clearChallengeCookie, clearSessionCookie, jsonResponse, readCookie } from "@/lib/auth/http";
import { decodeAuthSession } from "@/lib/auth/session";
import { limitAuthIp } from "@/lib/auth/rate-limit";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";

export function createAuthLogoutPost(securityStore?: AuthSecurityStore) {
return async function POST(request: Request): Promise<Response> {
  try {
    const config = getAuthRuntimeConfig();
    assertSameOrigin(request, config.appUrl);
    const store = securityStore ?? getAuthSecurityStore(config);
    await limitAuthIp(store, request, config, "logout");
    const token = readCookie(request, AUTH_SESSION_COOKIE);
    if (token) {
      let session;
      try { session = await decodeAuthSession(token, config.sessionSecret); }
      catch (error) { if (!(error instanceof AuthError && error.status === 401)) throw error; }
      if (session) await store.revokeSession(session.sessionId);
    }
    const challengeToken = readCookie(request, AUTH_CHALLENGE_COOKIE);
    if (challengeToken) {
      let challenge;
      try { challenge = await decodeAuthChallenge(challengeToken, config.sessionSecret); }
      catch (error) { if (!(error instanceof AuthError && error.status === 401)) throw error; }
      if (challenge) await store.consumeChallenge(challenge.input.requestId);
    }
    const headers = new Headers();
    clearChallengeCookie(headers, config);
    clearSessionCookie(headers, config);
    return jsonResponse({ authenticated: false }, { headers });
  } catch (error) {
    return authErrorResponse(error);
  }
};
}

export const POST = createAuthLogoutPost();
