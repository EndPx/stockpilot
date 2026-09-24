import { jsonResponse } from "@/lib/auth/http";
import { getAgentOAuthConfig } from "@/lib/control-plane/oauth-config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = getAgentOAuthConfig();
  return jsonResponse({ enabled: Boolean(config), mcpUrl: config?.resource ?? "" });
}
