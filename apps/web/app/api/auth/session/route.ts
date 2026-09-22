import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { authErrorResponse, clearSessionCookie, jsonResponse, readCookie } from "@/lib/auth/http";
import { readActiveAuthSession, toPublicSession } from "@/lib/auth/session";
import { limitAuthIp } from "@/lib/auth/rate-limit";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";

export function createAuthSessionGet(securityStore?: AuthSecurityStore) {
return async function GET(request: Request): Promise<Response> {
  let config: ReturnType<typeof getAuthRuntimeConfig> | undefined;

  try {
    config = getAuthRuntimeConfig();
    const store = securityStore ?? getAuthSecurityStore(config);
    await limitAuthIp(store, request, config, "session");
    const token = readCookie(request, AUTH_SESSION_COOKIE);
    if (!token) return jsonResponse({ authenticated: false });

    const session = await readActiveAuthSession(token, config, store);
    return jsonResponse(toPublicSession(session));
  } catch (error) {
    if (!config) return authErrorResponse(error);
    const headers = new Headers();
    if (error instanceof AuthError && error.status === 401) clearSessionCookie(headers, config);
    return authErrorResponse(
      error instanceof AuthError ? error : new AuthError("SESSION_INVALID", 401),
      headers,
    );
  }
};
}

export const GET = createAuthSessionGet();
