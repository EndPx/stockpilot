import { NextResponse, type NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "./config";
import { AuthError } from "./errors";
import { clearSessionCookie } from "./http";
import { readActiveAuthSession } from "./session";
import { getAuthSecurityStore, type AuthSecurityStore } from "./store";
import { isPrivyMode } from "@/lib/privy/config";
import { isProtectedPage, safeReturnPath } from "./page-paths";

function signInRedirect(request: NextRequest, appUrl: URL): NextResponse {
  const destination = new URL("/sign-in", appUrl);
  destination.searchParams.set("next", safeReturnPath(`${request.nextUrl.pathname}${request.nextUrl.search}`));
  return NextResponse.redirect(destination, request.method === "GET" || request.method === "HEAD" ? 307 : 303);
}

/** Page navigation guard; API routes keep their own authorization checks. */
export async function guardPrivyPage(request: NextRequest, securityStore?: AuthSecurityStore): Promise<NextResponse | null> {
  if (!isPrivyMode() || !isProtectedPage(request.nextUrl.pathname)) return null;

  let config: ReturnType<typeof getAuthRuntimeConfig>;
  try { config = getAuthRuntimeConfig(); }
  catch { return new NextResponse("Sign-in is temporarily unavailable.", { status: 503 }); }

  const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  if (!token) return signInRedirect(request, config.appUrl);

  try {
    await readActiveAuthSession(token, config, securityStore ?? getAuthSecurityStore(config));
    return null;
  } catch (error) {
    if (!(error instanceof AuthError) || error.status !== 401) {
      return new NextResponse("Session verification is temporarily unavailable.", { status: 503 });
    }
    const response = signInRedirect(request, config.appUrl);
    clearSessionCookie(response.headers, config);
    return response;
  }
}
