import { hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";
import { getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { enforceRateLimit, trustedClientIp } from "@/lib/auth/rate-limit";
import { getAuthSecurityStore, type AuthSecurityStore } from "@/lib/auth/store";
import { verifyCredential } from "@/lib/control-plane/credentials";
import { createStockPilotMcp } from "@/lib/control-plane/mcp";
import { getAgentOAuthConfig } from "@/lib/control-plane/oauth-config";
import { verifyOAuthCredential } from "@/lib/control-plane/oauth-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fixed, low-frequency failure categories only. Never log bearer bytes, claims,
// account IDs, client IDs, query strings, IPs, or request bodies.
const diagnosticAt = new Map<string, number>();
function recordAuthFailure(reason: string): void {
  const now = Date.now();
  if (now - (diagnosticAt.get(reason) ?? 0) < 60_000) return;
  diagnosticAt.set(reason, now);
  console.warn("[mcp-auth] Rejected", { reason });
}

function unauthorized(): Response {
  const oauth = getAgentOAuthConfig();
  const challenge = oauth
    ? `Bearer error="invalid_token", resource_metadata="${new URL("/.well-known/oauth-protected-resource", oauth.appOrigin)}"`
    : "Bearer";
  return jsonResponse({ error: { code: "INVALID_CREDENTIAL", message: "A valid StockPilot client credential is required." } },
    { status: 401, headers: { "WWW-Authenticate": challenge } });
}

export function createMcpPost(dependencies: {
  securityStore?: AuthSecurityStore;
  verify?: typeof verifyCredential;
  verifyOAuth?: typeof verifyOAuthCredential;
  createHandler?: typeof createStockPilotMcp;
} = {}) {
return async function POST(request: Request): Promise<Response> {
  try {
    const config = getAuthRuntimeConfig();
    const rejectedHost = hostHeaderValidationResponse(request, [config.appUrl.host]);
    if (rejectedHost) return rejectedHost;
    const rejectedOrigin = originValidationResponse(request, [config.appUrl.origin]);
    if (rejectedOrigin) return rejectedOrigin;
    if (new URL(request.url).search) return jsonResponse({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
    const security = dependencies.securityStore ?? getAuthSecurityStore(config);
    await enforceRateLimit(security, "ip:mcp", trustedClientIp(request, config), 120);
    const header = request.headers.get("authorization");
    if (!header) { recordAuthFailure("missing_bearer"); return unauthorized(); }
    if (!/^Bearer [A-Za-z0-9._-]{1,8192}$/.test(header)) { recordAuthFailure("invalid_bearer_format"); return unauthorized(); }
    const token = header.slice(7);
    const oauth = getAgentOAuthConfig();
    const principal = /^sp_live_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/.test(token)
      ? await (dependencies.verify ?? verifyCredential)(token)
      : oauth ? await (dependencies.verifyOAuth ?? verifyOAuthCredential)(token, oauth, {
        onFailure: (reason) => recordAuthFailure(`oauth_${reason}`),
      }) : null;
    if (!principal) {
      if (!oauth) recordAuthFailure("oauth_unavailable");
      return unauthorized();
    }
    await enforceRateLimit(security, "credential:mcp", principal.authMethod === "oauth"
      ? `${principal.oauthIssuer}:${principal.oauthSubject}:${principal.oauthClientId}` : principal.credentialId, 60);
    await enforceRateLimit(security, "account:mcp", principal.accountId, 180);
    const parsedBody = await readJsonBody(request, 65_536);
    const handler = (dependencies.createHandler ?? createStockPilotMcp)(principal);
    const response = await handler.fetch(request, {
      parsedBody,
      authInfo: { token: "[redacted]", clientId: principal.clientId, scopes: principal.scopes },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error("[mcp] Request failed", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: { code: "MCP_UNAVAILABLE", message: "StockPilot MCP is unavailable." } }, { status: 503 });
  }
};
}

export const POST = createMcpPost();
