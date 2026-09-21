import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { authErrorResponse, clearChallengeCookie, clearSessionCookie, jsonResponse } from "@/lib/auth/http";

export async function POST(request: Request): Promise<Response> {
  try {
    const config = getAuthRuntimeConfig();
    assertSameOrigin(request, config.appUrl);
    const headers = new Headers();
    clearChallengeCookie(headers, config);
    clearSessionCookie(headers, config);
    return jsonResponse({ authenticated: false }, { headers });
  } catch (error) {
    return authErrorResponse(error);
  }
}
