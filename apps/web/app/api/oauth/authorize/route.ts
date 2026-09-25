import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { jsonResponse, readCookie } from "@/lib/auth/http";
import { enforceRateLimit, trustedClientIp } from "@/lib/auth/rate-limit";
import { readActiveAuthSession } from "@/lib/auth/session";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";
import { bindOAuthSubject } from "@/lib/control-plane/oauth-binding";
import { getAgentOAuthConfig } from "@/lib/control-plane/oauth-config";
import { verifyOAuthHandoffProof } from "@/lib/control-plane/oauth-handoff";
import { readPrivyOAuthIdentity } from "@/lib/control-plane/oauth-privy-identity";
import { completeWorkosExternalAuth, externalAuthIdPattern, getWorkosUserByExternalId, WorkosApiProtocolError, WorkosApiStatusError } from "@/lib/control-plane/workos-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OAuthAuthorizeDependencies = {
  securityStore?: AuthSecurityStore;
  readIdentity?: typeof readPrivyOAuthIdentity;
  complete?: typeof completeWorkosExternalAuth;
  readUser?: typeof getWorkosUserByExternalId;
  bind?: typeof bindOAuthSubject;
};

function signInLocation(appUrl: URL, externalAuthId: string): URL {
  const signIn = new URL("/sign-in", appUrl);
  signIn.searchParams.set("next", `/api/oauth/authorize?external_auth_id=${encodeURIComponent(externalAuthId)}`);
  return signIn;
}

async function readHandoffForm(request: Request): Promise<{ externalAuthId: string; proof: string } | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return null;
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 2_048)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2_048) { await reader.cancel().catch(() => {}); return null; }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    const params = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const id = params.get("external_auth_id");
    const proof = params.get("handoff");
    return params.size === 2 && id && externalAuthIdPattern.test(id) && proof &&
      /^[A-Za-z0-9_.-]{1,1024}$/.test(proof) ? { externalAuthId: id, proof } : null;
  } catch { return null; }
}

/** WorkOS Login URI: authenticate the owner, then show StockPilot's handoff page. */
export function createOAuthAuthorizeGet(dependencies: OAuthAuthorizeDependencies = {}) {
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
    if (!cookie) return Response.redirect(signInLocation(auth.appUrl, externalAuthId), 303);
    stage = "session";
    let session;
    try { session = await readActiveAuthSession(cookie, auth, security); }
    catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401) throw error;
      return Response.redirect(signInLocation(auth.appUrl, externalAuthId), 303);
    }
    if (session.authProvider !== "privy" || !session.privyUserId) {
      return jsonResponse({ error: { code: "PRIVY_SESSION_REQUIRED" } }, { status: 403 });
    }
    stage = "session_rate_limit";
    await enforceRateLimit(security, "session:oauth-login", session.sessionId, 10);
    const connect = new URL("/connect", auth.appUrl);
    connect.searchParams.set("external_auth_id", externalAuthId);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Location: connect.toString() });
    return new Response(null, { status: 303, headers });
  } catch (error) {
    logOAuthFailure(stage, error);
    return jsonResponse({ error: { code: "OAUTH_LOGIN_UNAVAILABLE" } }, { status: 503 });
  }
};
}

function logOAuthFailure(stage: string, error: unknown): void {
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
}

/** The explicit owner click completes external authentication; WorkOS still owns consent. */
export function createOAuthAuthorizePost(dependencies: OAuthAuthorizeDependencies = {}) {
return async function POST(request: Request): Promise<Response> {
  const oauth = getAgentOAuthConfig();
  if (!oauth) return jsonResponse({ error: { code: "OAUTH_UNAVAILABLE" } }, { status: 503 });
  let stage = "request_validation";
  let auth: ReturnType<typeof getAuthRuntimeConfig> | null = null;
  try {
    auth = getAuthRuntimeConfig();
    const rejectedHost = hostHeaderValidationResponse(request, [auth.appUrl.host]);
    if (rejectedHost) return rejectedHost;
    if (request.headers.get("origin") !== auth.appUrl.origin || new URL(request.url).search) {
      return jsonResponse({ error: { code: "INVALID_OAUTH_REQUEST" } }, { status: 403 });
    }
    const handoff = await readHandoffForm(request);
    if (!handoff) return jsonResponse({ error: { code: "INVALID_OAUTH_REQUEST" } }, { status: 400 });
    const { externalAuthId, proof } = handoff;
    stage = "rate_limit";
    const security = dependencies.securityStore ?? getAuthSecurityStore(auth);
    await enforceRateLimit(security, "ip:oauth-login", trustedClientIp(request, auth), 30);
    const cookie = readCookie(request, AUTH_SESSION_COOKIE);
    if (!cookie) return Response.redirect(signInLocation(auth.appUrl, externalAuthId), 303);
    stage = "session";
    let session;
    try { session = await readActiveAuthSession(cookie, auth, security); }
    catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401) throw error;
      return Response.redirect(signInLocation(auth.appUrl, externalAuthId), 303);
    }
    if (session.authProvider !== "privy" || !session.privyUserId) {
      return jsonResponse({ error: { code: "PRIVY_SESSION_REQUIRED" } }, { status: 403 });
    }
    stage = "session_rate_limit";
    await enforceRateLimit(security, "session:oauth-login", session.sessionId, 10);
    stage = "handoff_binding";
    if (!(await verifyOAuthHandoffProof(proof, externalAuthId, session, auth.sessionSecret))) {
      return Response.redirect(new URL("/connect?error=unavailable", auth.appUrl), 303);
    }
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
    logOAuthFailure(stage, error);
    if (auth) return Response.redirect(new URL("/connect?error=unavailable", auth.appUrl), 303);
    return jsonResponse({ error: { code: "OAUTH_LOGIN_UNAVAILABLE" } }, { status: 503 });
  }
};
}

export const GET = createOAuthAuthorizeGet();
export const POST = createOAuthAuthorizePost();
