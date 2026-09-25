import { assertSameOrigin, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { jsonResponse } from "@/lib/auth/http";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";
import { getDelegatedSignerReadiness } from "@/lib/privy/delegated-signer";

export const dynamic = "force-dynamic";

export function createExecutionReadinessGet(dependencies: {
  owner?: typeof requireControlOwner;
  readiness?: typeof getDelegatedSignerReadiness;
} = {}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const origin = request.headers.get("origin");
      if (origin) assertSameOrigin(request, getAuthRuntimeConfig().appUrl);
      else if (request.headers.get("sec-fetch-site") !== "same-origin") {
        throw new AuthError("AUTH_REQUEST_INVALID", 403);
      }
      const identity = await (dependencies.owner ?? requireControlOwner)(request);
      const readiness = await (dependencies.readiness ?? getDelegatedSignerReadiness)(identity);
      return jsonResponse({ readiness, walletAddress: identity.walletAddress });
    } catch (error) { return controlApiError(error); }
  };
}

export const GET = createExecutionReadinessGet();
