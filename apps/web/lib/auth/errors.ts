import type { AuthErrorCode } from "./types";

const DEFAULT_MESSAGES: Record<AuthErrorCode, string> = {
  AUTH_CHALLENGE_EXPIRED: "This sign-in request expired. Request a new one.",
  AUTH_CHALLENGE_INVALID: "This sign-in request is not valid. Request a new one.",
  AUTH_SIGNATURE_INVALID: "The wallet signature could not be verified.",
  AUTH_WALLET_MISMATCH: "The signature does not match the connected wallet.",
  AUTH_DOMAIN_MISMATCH: "The sign-in request belongs to a different site.",
  AUTH_REPLAY_DETECTED: "This sign-in request was already used. Request a new one.",
  AUTH_REQUEST_INVALID: "The authentication request is not valid.",
  AUTH_DISABLED: "Wallet sign-in is not available on this deployment.",
  AUTH_UNAVAILABLE: "Authentication is temporarily unavailable. Please try again later.",
  AUTH_RATE_LIMITED: "Too many requests. Please wait before trying again.",
  SESSION_INVALID: "The authentication session is not valid.",
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: AuthErrorCode, status = 400, message = DEFAULT_MESSAGES[code], retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function toAuthError(error: unknown): AuthError {
  return error instanceof AuthError
    ? error
    : new AuthError("AUTH_REQUEST_INVALID", 400);
}
