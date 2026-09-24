import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { AgentPrincipal } from "./credentials";
import { resolveOAuthPrincipal } from "./oauth-binding";
import type { AgentOAuthConfig } from "./oauth-config";
import { getWorkosUserById } from "./workos-api";

type WorkosAccessClaims = { subject: string; clientId: string };
type JwtFailureReason = "jwt_expired" | "jwt_issuer" | "jwt_audience" | "jwt_algorithm" |
  "jwt_signature" | "jwt_key_unavailable" | "jwt_claims_subject" | "jwt_claims_client" |
  "jwt_claims_consent" | "jwt_claims_id" | "jwt_claims_lifetime" | "jwt_claims_scope" |
  "jwt_unclassified";
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
  return inspectWorkosAccessClaims(payload).claims;
}

function inspectWorkosAccessClaims(payload: JWTPayload): { claims: WorkosAccessClaims | null; reason: JwtFailureReason | null } {
  const subject = payload.sub;
  const clientId = payload.client_id;
  if (typeof subject !== "string" || !/^user_[A-Za-z0-9_-]{8,128}$/.test(subject))
    return { claims: null, reason: "jwt_claims_subject" };
  if (!validOAuthClientId(clientId)) return { claims: null, reason: "jwt_claims_client" };
  if (typeof payload.sid !== "string" || payload.sid.length < 8 || payload.sid.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(payload.sid)) return { claims: null, reason: "jwt_claims_consent" };
  if (typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 200)
    return { claims: null, reason: "jwt_claims_id" };
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.exp <= payload.iat)
    return { claims: null, reason: "jwt_claims_lifetime" };
  // WorkOS gives CIMD/DCR clients standard OIDC scopes; StockPilot's operation
  // scopes are granted and rechecked in its own database, never inferred here.
  if (typeof payload.scope !== "string" || !payload.scope.split(/\s+/).includes("openid"))
    return { claims: null, reason: "jwt_claims_scope" };
  return { claims: { subject, clientId }, reason: null };
}

function verificationFailure(error: unknown): JwtFailureReason {
  if (error === null || typeof error !== "object" || !("code" in error)) return "jwt_unclassified";
  switch (error.code) {
    case "ERR_JWT_EXPIRED": return "jwt_expired";
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED": return "jwt_signature";
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWKS_MULTIPLE_MATCHING_KEYS":
    case "ERR_JWKS_TIMEOUT": return "jwt_key_unavailable";
    case "ERR_JOSE_ALG_NOT_ALLOWED": return "jwt_algorithm";
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      if (!("claim" in error)) return "jwt_unclassified";
      if (error.claim === "iss") return "jwt_issuer";
      if (error.claim === "aud") return "jwt_audience";
      return "jwt_unclassified";
    }
    default: return "jwt_unclassified";
  }
}

export async function verifySignedToken(
  token: string,
  config: AgentOAuthConfig,
  keys: JWTVerifyGetKey = getKeySet(config.issuer),
  onFailure?: (reason: JwtFailureReason) => void,
): Promise<WorkosAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: ["RS256"],
      clockTolerance: "5s",
    });
    if (payload.aud !== config.resource) { onFailure?.("jwt_audience"); return null; }
    const inspected = inspectWorkosAccessClaims(payload);
    if (inspected.reason) onFailure?.(inspected.reason);
    return inspected.claims;
  } catch (error) { onFailure?.(verificationFailure(error)); return null; }
}

export async function verifyOAuthCredential(
  token: string,
  config: AgentOAuthConfig,
  dependencies: {
    verifyToken?: typeof verifySignedToken;
    readUser?: typeof getWorkosUserById;
    resolve?: typeof resolveOAuthPrincipal;
    onFailure?: (reason: "token_shape" | "jwt_rejected" | "identity_mismatch" | "principal_unavailable" | JwtFailureReason) => void;
  } = {},
): Promise<AgentPrincipal | null> {
  if (typeof token !== "string" || token.length < 100 || token.length > 8_192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    dependencies.onFailure?.("token_shape");
    return null;
  }
  let classified = false;
  const claims = await (dependencies.verifyToken ?? verifySignedToken)(token, config, undefined, (reason) => {
    classified = true;
    dependencies.onFailure?.(reason);
  });
  if (!claims) { if (!classified) dependencies.onFailure?.("jwt_rejected"); return null; }
  // Local connection revocation is checked on every request below. A WorkOS
  // consent revoked only upstream may leave an already-issued JWT usable until
  // its expiry; CIMD clients do not give us an introspection client secret.
  const user = await (dependencies.readUser ?? getWorkosUserById)(claims.subject, config);
  if (user.id !== claims.subject) { dependencies.onFailure?.("identity_mismatch"); return null; }
  const principal = await (dependencies.resolve ?? resolveOAuthPrincipal)(claims, user.externalId, config);
  if (!principal) dependencies.onFailure?.("principal_unavailable");
  return principal;
}
