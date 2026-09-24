import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { jsonResponse, readCookie } from "@/lib/auth/http";
import { enforceRateLimit, trustedClientIp } from "@/lib/auth/rate-limit";
import { readActiveAuthSession } from "@/lib/auth/session";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";
import { bindOAuthSubject } from "@/lib/control-plane/oauth-binding";
import { getAgentOAuthConfig } from "@/lib/control-plane/oauth-config";
import { readPrivyOAuthIdentity } from "@/lib/control-plane/oauth-privy-identity";
import { completeWorkosExternalAuth, externalAuthIdPattern, getWorkosUserByExternalId, WorkosApiProtocolError, WorkosApiStatusError } from "@/lib/control-plane/workos-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function createOAuthAuthorizeGet(dependencies: {
  securityStore?: AuthSecurityStore;
  readIdentity?: typeof readPrivyOAuthIdentity;
  complete?: typeof completeWorkosExternalAuth;
  readUser?: typeof getWorkosUserByExternalId;
  bind?: typeof bindOAuthSubject;
} = {}) {
/** Login URI configured under WorkOS Connect → Configuration. WorkOS owns consent and OAuth code exchange. */
return async function GET(request: Request): Promise<Response> {
  const oauth = getAgentOAuthConfig();
  if (!oauth) return jsonResponse({ error: { code: "OAUTH_UNAVAILABLE" } }, { status: 503 });
  let stage = "request_validation";
  try {
    const auth = getAuthRuntimeConfig();
    const rejectedHost = hostHeaderValidationResponse(request, [auth.appUrl.host]);
    if (rejectedHost) return rejectedHost;
    const url = new URL(request.url);
    const externalAuthId = url.searchParams.get("external_auth_id");
    if (url.searchParams.size !== 1 || !externalAuthId || !externalAuthIdPattern.test(externalAuthId)) {
      return jsonResponse({ error: { code: "INVALID_OAUTH_REQUEST" } }, { status: 400 });
    }
    stage = "rate_limit";
    const security = dependencies.securityStore ?? getAuthSecurityStore(auth);
    await enforceRateLimit(security, "ip:oauth-login", trustedClientIp(request, auth), 30);
    const cookie = readCookie(request, AUTH_SESSION_COOKIE);
    if (!cookie) {
      const signIn = new URL("/sign-in", auth.appUrl);
      signIn.searchParams.set("next", `/api/oauth/authorize?external_auth_id=${encodeURIComponent(externalAuthId)}`);
      return Response.redirect(signIn, 303);
    }
    stage = "session";
    let session;
    try { session = await readActiveAuthSession(cookie, auth, security); }
    catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401) throw error;
      const signIn = new URL("/sign-in", auth.appUrl);
      signIn.searchParams.set("next", `/api/oauth/authorize?external_auth_id=${encodeURIComponent(externalAuthId)}`);
      return Response.redirect(signIn, 303);
    }
    if (session.authProvider !== "privy" || !session.privyUserId) {
      return jsonResponse({ error: { code: "PRIVY_SESSION_REQUIRED" } }, { status: 403 });
    }
    stage = "session_rate_limit";
    await enforceRateLimit(security, "session:oauth-login", session.sessionId, 10);
    stage = "privy_identity";
    const identity = await (dependencies.readIdentity ?? readPrivyOAuthIdentity)(session.privyUserId, session.walletAddress);
    stage = "workos_complete";
    const redirect = await (dependencies.complete ?? completeWorkosExternalAuth)(externalAuthId, session.privyUserId, identity.email, oauth);
    stage = "workos_user";
    const workosUser = await (dependencies.readUser ?? getWorkosUserByExternalId)(session.privyUserId, oauth);
    stage = "neon_bind";
    await (dependencies.bind ?? bindOAuthSubject)({
      privyUserId: session.privyUserId,
      walletAddress: session.walletAddress,
      workosUserId: workosUser.id,
    }, oauth);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    headers.set("Location", redirect.toString());
    return new Response(null, { status: 303, headers });
  } catch (error) {
    const upstreamStatus = error instanceof WorkosApiStatusError ? error.status : undefined;
    const failureKind = error instanceof WorkosApiStatusError ? "workos_http" :
      error instanceof WorkosApiProtocolError ? error.code :
      error instanceof Error && error.name === "TimeoutError" ? "timeout" :
      error instanceof SyntaxError ? "invalid_json" :
      error instanceof TypeError ? "transport" : "unexpected";
    const sqlstate = stage === "neon_bind" && error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined;
    // Never log auth IDs, user/email/wallet identifiers, redirect URLs, tokens, or upstream bodies.
    console.error("[oauth-login] Flow failed", { stage, failureKind, upstreamStatus, sqlstate });
    return jsonResponse({ error: { code: "OAUTH_LOGIN_UNAVAILABLE" } }, { status: 503 });
  }
};
}

export const GET = createOAuthAuthorizeGet();
