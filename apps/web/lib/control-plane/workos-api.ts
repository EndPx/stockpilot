import "server-only";
import type { AgentOAuthConfig } from "./oauth-config";

const workosApi = "https://api.workos.com";
const workosUserId = /^user_[A-Za-z0-9_-]{8,128}$/;
export const externalAuthIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

export type WorkosUser = { id: string; externalId: string };

/** Safe diagnostic metadata only; never retain the upstream response body. */
export class WorkosApiStatusError extends Error {
  constructor(readonly status: number) {
    super("WorkOS API request failed");
    this.name = "WorkosApiStatusError";
  }
}

export type WorkosProtocolFailure = "invalid_identity" | "missing_redirect" | "malformed_redirect" |
  "untrusted_origin" | "untrusted_path" | "untrusted_redirect";

/** Fixed diagnostic codes only; never carry provider payloads or redirect values. */
export class WorkosApiProtocolError extends Error {
  constructor(readonly code: WorkosProtocolFailure) {
    super("WorkOS protocol validation failed");
    this.name = "WorkosApiProtocolError";
  }
}

async function requestWorkos(path: string, config: AgentOAuthConfig, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const response = await fetcher(`${workosApi}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      ...init.headers,
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new WorkosApiStatusError(response.status);
  return response.json();
}

function parseUser(value: unknown, expectedExternalId?: string): WorkosUser {
  if (!value || typeof value !== "object") throw new Error("WorkOS user response is invalid");
  const user = value as { id?: unknown; external_id?: unknown };
  if (typeof user.id !== "string" || !workosUserId.test(user.id) ||
    typeof user.external_id !== "string" || !user.external_id.startsWith("did:privy:") ||
    user.external_id.length > 128 ||
    (expectedExternalId && user.external_id !== expectedExternalId)) {
    throw new Error("WorkOS user is not bound to the expected Privy account");
  }
  return { id: user.id, externalId: user.external_id };
}

export async function getWorkosUserById(userId: string, config: AgentOAuthConfig, fetcher: typeof fetch = fetch): Promise<WorkosUser> {
  if (!workosUserId.test(userId)) throw new Error("Invalid WorkOS user ID");
  return parseUser(await requestWorkos(`/user_management/users/${encodeURIComponent(userId)}`, config, {}, fetcher));
}

export async function getWorkosUserByExternalId(privyUserId: string, config: AgentOAuthConfig, fetcher: typeof fetch = fetch): Promise<WorkosUser> {
  if (!privyUserId.startsWith("did:privy:") || privyUserId.length > 128) throw new Error("Invalid Privy user ID");
  const user = await requestWorkos(`/user_management/users/external_id/${encodeURIComponent(privyUserId)}`, config, {}, fetcher);
  return parseUser(user, privyUserId);
}

export async function completeWorkosExternalAuth(
  externalAuthId: string,
  privyUserId: string,
  email: string,
  config: AgentOAuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<URL> {
  if (!externalAuthIdPattern.test(externalAuthId) || !privyUserId.startsWith("did:privy:") ||
    privyUserId.length > 128 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new WorkosApiProtocolError("invalid_identity");
  }
  const value = await requestWorkos("/authkit/oauth2/complete", config, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_auth_id: externalAuthId, user: { id: privyUserId, email } }),
    signal: AbortSignal.timeout(15_000),
  }, fetcher);
  const redirect = value && typeof value === "object" ? (value as { redirect_uri?: unknown }).redirect_uri : null;
  if (typeof redirect !== "string") throw new WorkosApiProtocolError("missing_redirect");
  let url: URL;
  try { url = new URL(redirect); }
  catch { throw new WorkosApiProtocolError("malformed_redirect"); }
  if (url.origin !== config.issuer) throw new WorkosApiProtocolError("untrusted_origin");
  if (url.username || url.password || url.hash) throw new WorkosApiProtocolError("untrusted_redirect");
  // AuthKit's documented path and its OAuth2 completion variant are both
  // restricted to the configured HTTPS issuer, never an arbitrary redirect.
  if (url.pathname !== "/oauth/authorize/complete" && url.pathname !== "/oauth2/authorize/complete") {
    throw new WorkosApiProtocolError("untrusted_path");
  }
  return url;
}
