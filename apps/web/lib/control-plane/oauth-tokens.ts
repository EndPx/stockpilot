import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { AgentPrincipal } from "./credentials";
import { resolveOAuthPrincipal } from "./oauth-binding";
import type { AgentOAuthConfig } from "./oauth-config";
import { getWorkosUserById } from "./workos-api";

type WorkosAccessClaims = { subject: string; clientId: string };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function validOAuthClientId(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 8 || value.length > 1_024) return false;
  if (/^client_[A-Za-z0-9_-]{8,128}$/.test(value)) return true;
  // CIMD uses an HTTPS URL as client_id; DCR/dashboard clients use client_ IDs.
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

function getKeySet(issuer: string) {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/oauth2/jwks", issuer), {
      timeoutDuration: 3_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 5 * 60_000,
    });
    keySets.set(issuer, keys);
  }
  return keys;
}

/** Reject ID tokens, M2M tokens and tokens for another resource before any database access. */
export function parseWorkosAccessClaims(payload: JWTPayload): WorkosAccessClaims | null {
  // WorkOS gives CIMD/DCR clients standard OIDC scopes; StockPilot's operation
  // scopes are granted and rechecked in its own database, never inferred here.
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  if (typeof payload.sub !== "string" || !/^user_[A-Za-z0-9_-]{8,128}$/.test(payload.sub) ||
    !validOAuthClientId(payload.client_id) ||
    typeof payload.sid !== "string" || payload.sid.length < 8 || payload.sid.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(payload.sid) ||
    typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 200 ||
    typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.exp <= payload.iat ||
    !scopes.includes("openid")) return null;
  return { subject: payload.sub, clientId: payload.client_id };
}

export async function verifySignedToken(
  token: string,
  config: AgentOAuthConfig,
  keys: JWTVerifyGetKey = getKeySet(config.issuer),
): Promise<WorkosAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: ["RS256"],
      clockTolerance: "5s",
    });
    if (payload.aud !== config.resource) return null;
    return parseWorkosAccessClaims(payload);
  } catch { return null; }
}

export async function verifyOAuthCredential(
  token: string,
  config: AgentOAuthConfig,
  dependencies: {
    verifyToken?: typeof verifySignedToken;
    readUser?: typeof getWorkosUserById;
    resolve?: typeof resolveOAuthPrincipal;
    onFailure?: (reason: "token_shape" | "jwt_rejected" | "identity_mismatch" | "principal_unavailable") => void;
  } = {},
): Promise<AgentPrincipal | null> {
  if (typeof token !== "string" || token.length < 100 || token.length > 8_192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    dependencies.onFailure?.("token_shape");
    return null;
  }
  const claims = await (dependencies.verifyToken ?? verifySignedToken)(token, config);
  if (!claims) { dependencies.onFailure?.("jwt_rejected"); return null; }
  // Local connection revocation is checked on every request below. A WorkOS
  // consent revoked only upstream may leave an already-issued JWT usable until
  // its expiry; CIMD clients do not give us an introspection client secret.
  const user = await (dependencies.readUser ?? getWorkosUserById)(claims.subject, config);
  if (user.id !== claims.subject) { dependencies.onFailure?.("identity_mismatch"); return null; }
  const principal = await (dependencies.resolve ?? resolveOAuthPrincipal)(claims, user.externalId, config);
  if (!principal) dependencies.onFailure?.("principal_unavailable");
  return principal;
}
