import { decodeAuthChallenge } from "@/lib/auth/challenge";
import { AUTH_CHALLENGE_COOKIE, assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { authErrorResponse, clearChallengeCookie, jsonResponse, readCookie, readJsonBody, setSessionCookie } from "@/lib/auth/http";
import { parseAuthVerifyRequest, verifyAuthProof } from "@/lib/auth/proof";
import { createAuthSession, encodeAuthSession, toPublicSession } from "@/lib/auth/session";

export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof getAuthRuntimeConfig> | undefined;
  let headers: Headers | undefined;

  try {
    config = getAuthRuntimeConfig();
    assertSameOrigin(request, config.appUrl);
    const body = parseAuthVerifyRequest(await readJsonBody(request));
    const challengeToken = readCookie(request, AUTH_CHALLENGE_COOKIE);
    headers = new Headers();
    clearChallengeCookie(headers, config);

    if (!challengeToken) {
      throw new AuthError("AUTH_REPLAY_DETECTED", 401);
    }

    const challenge = await decodeAuthChallenge(challengeToken, config.sessionSecret);
    if (body.requestId !== challenge.input.requestId) {
      throw new AuthError("AUTH_CHALLENGE_INVALID", 401);
    }

    verifyAuthProof(challenge.input, body);
    const session = createAuthSession(challenge.input.address);
    const sessionToken = await encodeAuthSession(session, config.sessionSecret);
    setSessionCookie(headers, sessionToken, config);
    return jsonResponse(toPublicSession(session), { headers });
  } catch (error) {
    if (config && !headers) {
      headers = new Headers();
      clearChallengeCookie(headers, config);
    }
    return authErrorResponse(error, headers);
  }
}
