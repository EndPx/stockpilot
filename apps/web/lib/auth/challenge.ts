import { address } from "@solana/kit";
import { AUTH_CHALLENGE_TTL_MS, AUTH_STATEMENT, type AuthRuntimeConfig } from "./config";
import { AuthError } from "./errors";
import { createSignedToken, readSignedToken } from "./tokens";
import type { AuthChallengeToken, AuthSignInInput } from "./types";

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function normalizeWalletAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError("AUTH_REQUEST_INVALID", 400);
  }

  try {
    return address(value).toString();
  } catch {
    throw new AuthError("AUTH_REQUEST_INVALID", 400, "A valid Solana wallet address is required.");
  }
}

export function createAuthChallenge(
  walletAddress: string,
  config: Pick<AuthRuntimeConfig, "appUrl">,
  now = Date.now(),
): AuthChallengeToken {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const issuedAt = new Date(now);
  const expiresAt = now + AUTH_CHALLENGE_TTL_MS;
  const input: AuthSignInInput = {
    domain: config.appUrl.host,
    address: normalizedAddress,
    statement: AUTH_STATEMENT,
    uri: config.appUrl.origin,
    version: "1",
    chainId: "solana:mainnet",
    nonce: randomNonce(),
    issuedAt: issuedAt.toISOString(),
    expirationTime: new Date(expiresAt).toISOString(),
    requestId: crypto.randomUUID(),
  };

  return { kind: "challenge", input, expiresAt };
}

function isAuthChallengeToken(value: unknown): value is AuthChallengeToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<AuthChallengeToken>;
  const input = token.input as Partial<AuthSignInInput> | undefined;

  return token.kind === "challenge" &&
    typeof token.expiresAt === "number" && Number.isFinite(token.expiresAt) &&
    !!input &&
    typeof input.domain === "string" &&
    typeof input.address === "string" &&
    typeof input.statement === "string" &&
    typeof input.uri === "string" &&
    input.version === "1" &&
    input.chainId === "solana:mainnet" &&
    typeof input.nonce === "string" && /^[0-9a-f]{32}$/.test(input.nonce) &&
    typeof input.issuedAt === "string" &&
    typeof input.expirationTime === "string" &&
    typeof input.requestId === "string" && /^[0-9a-f-]{36}$/.test(input.requestId);
}

export async function encodeAuthChallenge(
  challenge: AuthChallengeToken,
  secret: string,
): Promise<string> {
  return createSignedToken(challenge, secret);
}

export async function decodeAuthChallenge(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<AuthChallengeToken> {
  let value: unknown;
  try {
    value = await readSignedToken(token, secret);
  } catch {
    throw new AuthError("AUTH_CHALLENGE_INVALID", 401);
  }

  if (!isAuthChallengeToken(value)) {
    throw new AuthError("AUTH_CHALLENGE_INVALID", 401);
  }
  const issuedAt = Date.parse(value.input.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt > now || value.expiresAt - issuedAt !== AUTH_CHALLENGE_TTL_MS || Date.parse(value.input.expirationTime) !== value.expiresAt) {
    throw new AuthError("AUTH_CHALLENGE_INVALID", 401);
  }
  if (value.expiresAt <= now || Date.parse(value.input.expirationTime) <= now) {
    throw new AuthError("AUTH_CHALLENGE_EXPIRED", 401);
  }

  return value;
}
