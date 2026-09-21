import { address } from "@solana/kit";
import { AUTH_SESSION_TTL_MS } from "./config";
import { AuthError } from "./errors";
import { createSignedToken, readSignedToken } from "./tokens";
import type { AuthSession, AuthSessionToken } from "./types";

export function createAuthSession(walletAddress: string, now = Date.now()): AuthSessionToken {
  return {
    kind: "session",
    walletAddress: address(walletAddress).toString(),
    sessionId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS,
  };
}

function isAuthSessionToken(value: unknown): value is AuthSessionToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<AuthSessionToken>;
  return token.kind === "session" &&
    typeof token.walletAddress === "string" &&
    typeof token.sessionId === "string" &&
    typeof token.issuedAt === "number" &&
    typeof token.expiresAt === "number";
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

  if (!isAuthSessionToken(value) || value.expiresAt <= now) {
    throw new AuthError("SESSION_INVALID", 401);
  }

  try {
    address(value.walletAddress);
  } catch {
    throw new AuthError("SESSION_INVALID", 401);
  }

  return value;
}

export function toPublicSession(session: AuthSessionToken): AuthSession {
  return {
    authenticated: true,
    walletAddress: session.walletAddress,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}
