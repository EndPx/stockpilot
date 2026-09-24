import "server-only";
import { jsonResponse } from "@/lib/auth/http";
import { getAgentOAuthConfig } from "./oauth-config";

export function protectedResourceMetadata(): Response {
  const config = getAgentOAuthConfig();
  if (!config) return jsonResponse({ error: { code: "OAUTH_UNAVAILABLE" } }, { status: 503 });
  return jsonResponse({
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
  });
}

/** Compatibility endpoint for clients that try AS discovery on the MCP host. */
export async function authorizationServerMetadata(fetcher: typeof fetch = fetch): Promise<Response> {
  const config = getAgentOAuthConfig();
  if (!config) return jsonResponse({ error: { code: "OAUTH_UNAVAILABLE" } }, { status: 503 });
  try {
    const response = await fetcher(`${config.issuer}/.well-known/oauth-authorization-server`, {
      headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("WorkOS metadata unavailable");
    const metadata: unknown = await response.json();
    if (!metadata || typeof metadata !== "object") throw new Error("WorkOS metadata invalid");
    const value = metadata as { issuer?: unknown; authorization_endpoint?: unknown; token_endpoint?: unknown };
    if (value.issuer !== config.issuer ||
      typeof value.authorization_endpoint !== "string" || new URL(value.authorization_endpoint).origin !== config.issuer ||
      typeof value.token_endpoint !== "string" || new URL(value.token_endpoint).origin !== config.issuer) {
      throw new Error("WorkOS metadata issuer mismatch");
    }
    return jsonResponse(metadata);
  } catch {
    return jsonResponse({ error: { code: "OAUTH_METADATA_UNAVAILABLE" } }, { status: 503 });
  }
}
