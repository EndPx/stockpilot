import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { AuthRuntimeConfig } from "./config";
import { AuthError } from "./errors";
import type { AuthSecurityStore } from "./store";

export function trustedClientIp(request: Request, config: Pick<AuthRuntimeConfig, "trustProxy">): string {
  // The private reverse proxy must overwrite X-Real-IP and prevent direct app access.
  const candidate = config.trustProxy ? request.headers.get("x-real-ip") : null;
  return candidate && isIP(candidate) ? candidate : "untrusted";
}

export async function enforceRateLimit(store: AuthSecurityStore, scope: string, identity: string, limit: number, windowMs = 60_000): Promise<void> {
  const key = `${scope}:${createHash("sha256").update(identity).digest("hex")}`;
  const result = await store.takeRateLimit(key, limit, windowMs);
  if (!result.allowed) throw new AuthError("AUTH_RATE_LIMITED", 429, undefined, result.retryAfterSeconds);
}

export function limitAuthIp(store: AuthSecurityStore, request: Request, config: AuthRuntimeConfig, action: "challenge" | "verify" | "session" | "logout") {
  const limits = { challenge: 20, verify: 30, session: 120, logout: 30 };
  return enforceRateLimit(store, `ip:${action}`, trustedClientIp(request, config), limits[action]);
}
