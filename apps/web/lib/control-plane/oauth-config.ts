import "server-only";
import { getAuthRuntimeConfig } from "@/lib/auth/config";
import { isPrivyMode } from "@/lib/privy/config";

export type AgentOAuthConfig = {
  issuer: string;
  apiKey: string;
  appOrigin: string;
  resource: string;
};

function validIssuer(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch { return null; }
}

/** OAuth is opt-in even when WorkOS environment variables are present. */
export function getAgentOAuthConfig(): AgentOAuthConfig | null {
  if (process.env.AGENT_OAUTH_ENABLED !== "true" || !isPrivyMode() ||
    !process.env.PRIVY_APP_SECRET || !process.env.CONTROL_PLANE_DATABASE_URL) return null;
  const issuer = validIssuer(process.env.WORKOS_AUTHKIT_ISSUER);
  const apiKey = process.env.WORKOS_API_KEY;
  if (!issuer || !apiKey || apiKey.length < 16) return null;
  try {
    const auth = getAuthRuntimeConfig();
    if (auth.production && auth.appUrl.protocol !== "https:") return null;
    return {
      issuer,
      apiKey,
      appOrigin: auth.appUrl.origin,
      resource: new URL("/api/mcp", auth.appUrl).toString(),
    };
  } catch { return null; }
}
