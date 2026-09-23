import { address } from "@solana/kit";
import { AUTH_SESSION_TTL_MS, getAuthRuntimeConfig, type AuthRuntimeConfig } from "./config";
import { AuthError } from "./errors";
import { createSignedToken, readSignedToken } from "./tokens";
import type { AuthSession, AuthSessionToken } from "./types";
import { getAuthSecurityStore, type AuthSecurityStore } from "./store";
import { isPrivyMode } from "@/lib/privy/config";

export function createAuthSession(walletAddress: string, now = Date.now(), privyUserId?: string, privyTokenExpiresAt?: number): AuthSessionToken {
  return {
    kind: "session",
    ...(privyUserId ? { authProvider: "privy" as const, privyUserId } : {}),
    walletAddress: address(walletAddress).toString(),
    sessionId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: privyUserId ? Math.min(now + 55 * 60 * 1_000, privyTokenExpiresAt ?? now) : now + AUTH_SESSION_TTL_MS,
  };
}

function isAuthSessionToken(value: unknown): value is AuthSessionToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<AuthSessionToken>;
  return token.kind === "session" &&
    typeof token.walletAddress === "string" &&
    typeof token.sessionId === "string" && /^[0-9a-f-]{36}$/.test(token.sessionId) &&
    typeof token.issuedAt === "number" && Number.isFinite(token.issuedAt) &&
    typeof token.expiresAt === "number" && Number.isFinite(token.expiresAt);
}

export async function encodeAuthSession(session: AuthSessionToken, secret: string): Promise<string> {
  return createSignedToken(session, secret);
}

export async function decodeAuthSession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<AuthSessionToken> {
  let value: unknown;
  try {
    value = await readSignedToken(token, secret);
  } catch {
    throw new AuthError("SESSION_INVALID", 401);
  }

  if (!isAuthSessionToken(value) || value.expiresAt <= now || value.issuedAt > now ||
    (value.authProvider === "privy"
      ? value.expiresAt - value.issuedAt > 55 * 60 * 1_000 || value.expiresAt <= value.issuedAt
      : value.expiresAt - value.issuedAt !== AUTH_SESSION_TTL_MS) ||
    (isPrivyMode() && (value.authProvider !== "privy" || !value.privyUserId)) ||
    (!isPrivyMode() && value.authProvider === "privy")) {
    throw new AuthError("SESSION_INVALID", 401);
  }

  try {
    address(value.walletAddress);
  } catch {
    throw new AuthError("SESSION_INVALID", 401);
  }

  return value;
}

export async function registerAuthSession(
  session: AuthSessionToken,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
  store: AuthSecurityStore = getAuthSecurityStore(config),
): Promise<void> {
  await store.registerSession(session.sessionId, { walletAddress: session.walletAddress, expiresAt: session.expiresAt });
}

/** Every authenticated request must use this check, not signature-only decoding. */
export async function readActiveAuthSession(
  token: string,
  config: AuthRuntimeConfig,
  store: AuthSecurityStore = getAuthSecurityStore(config),
): Promise<AuthSessionToken> {
  const session = await decodeAuthSession(token, config.sessionSecret);
  const registered = await store.readSession(session.sessionId);
  if (!registered || registered.walletAddress !== session.walletAddress || registered.expiresAt !== session.expiresAt || registered.expiresAt <= Date.now()) {
    throw new AuthError("SESSION_INVALID", 401);
  }
  return session;
}

export function toPublicSession(session: AuthSessionToken): AuthSession {
  return {
    authenticated: true,
    walletAddress: session.walletAddress,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}
