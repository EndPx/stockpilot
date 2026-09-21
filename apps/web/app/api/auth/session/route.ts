import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { authErrorResponse, clearSessionCookie, jsonResponse, readCookie } from "@/lib/auth/http";
import { decodeAuthSession, toPublicSession } from "@/lib/auth/session";

export async function GET(request: Request): Promise<Response> {
  let config: ReturnType<typeof getAuthRuntimeConfig> | undefined;

  try {
    config = getAuthRuntimeConfig();
    const token = readCookie(request, AUTH_SESSION_COOKIE);
    if (!token) return jsonResponse({ authenticated: false });

    const session = await decodeAuthSession(token, config.sessionSecret);
    return jsonResponse(toPublicSession(session));
  } catch (error) {
    if (!config) return authErrorResponse(error);
    const headers = new Headers();
    clearSessionCookie(headers, config);
    return authErrorResponse(
      error instanceof AuthError ? error : new AuthError("AUTH_SESSION_INVALID", 401),
      headers,
    );
  }
}
