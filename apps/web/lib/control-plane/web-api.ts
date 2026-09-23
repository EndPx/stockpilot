import "server-only";
import { assertSameOrigin, AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "@/lib/auth/config";
import { AuthError } from "@/lib/auth/errors";
import { jsonResponse, readCookie } from "@/lib/auth/http";
import { enforceRateLimit, trustedClientIp } from "@/lib/auth/rate-limit";
import { readActiveAuthSession } from "@/lib/auth/session";
import { getAuthSecurityStore } from "@/lib/auth/store";
import { ControlPlaneError, type ControlIdentity } from "./clients";
import { ApprovalError } from "./approvals";
import { RequestError } from "./requests";

export async function requireControlOwner(request: Request, mutation = false): Promise<ControlIdentity> {
  const config = getAuthRuntimeConfig();
  if (mutation) assertSameOrigin(request, config.appUrl);
  const security = getAuthSecurityStore(config);
  await enforceRateLimit(security, "ip:control", trustedClientIp(request, config), 120);
  const token = readCookie(request, AUTH_SESSION_COOKIE);
  if (!token) throw new AuthError("SESSION_INVALID", 401);
  const session = await readActiveAuthSession(token, config, security);
  if (session.authProvider !== "privy" || !session.privyUserId) throw new AuthError("SESSION_INVALID", 401);
  await enforceRateLimit(security, mutation ? "session:control-write" : "session:control-read", session.sessionId,
    mutation ? 30 : 120);
  return { privyUserId: session.privyUserId, walletAddress: session.walletAddress };
}

export function controlApiError(error: unknown): Response {
  if (error instanceof AuthError) {
    const headers = error.retryAfterSeconds === undefined ? undefined : { "Retry-After": String(error.retryAfterSeconds) };
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
  if (error instanceof ControlPlaneError || error instanceof RequestError || error instanceof ApprovalError) {
    const status = ["CLIENT_NOT_FOUND", "POLICY_NOT_FOUND", "REQUEST_NOT_FOUND", "ASSET_UNAVAILABLE"].includes(error.code) ? 404
      : ["WALLET_BINDING_MISMATCH", "CLIENT_NOT_ALLOWED"].includes(error.code) ? 403
        : ["REQUEST_NOT_PENDING", "POLICY_LIMIT"].includes(error.code) ? 409 : 400;
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status });
  }
  console.error("[control-plane] Request failed", error instanceof Error ? error.name : "UnknownError");
  return jsonResponse({ error: { code: "CONTROL_PLANE_UNAVAILABLE", message: "StockPilot control plane is unavailable." } }, { status: 503 });
}

export function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ControlPlaneError("INVALID_CLIENT", "Invalid control-plane request.");
  }
  return value as Record<string, unknown>;
}
