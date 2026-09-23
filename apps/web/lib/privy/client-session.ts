import type { AuthSession, AuthErrorCode } from "@/lib/auth/types";

export class PrivySessionError extends Error {
  constructor(message: string, readonly code?: AuthErrorCode) {
    super(message);
  }
}

function isSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AuthSession>;
  return session.authenticated === true && typeof session.walletAddress === "string" &&
    session.walletAddress.length >= 32 && typeof session.expiresAt === "string";
}

export async function exchangePrivySession(
  getAccessToken: () => Promise<string | null>,
  options: {
    signal?: AbortSignal;
    request?: typeof fetch;
    pause?: (ms: number) => Promise<void>;
  } = {},
): Promise<AuthSession> {
  const token = await getAccessToken();
  if (!token) throw new PrivySessionError("Your Privy session is not ready. Please sign in again.");
  const request = options.request ?? fetch;
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request("/api/auth/privy", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      signal: options.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) {
      if (!isSession(body)) throw new PrivySessionError("StockPilot returned an invalid wallet session.");
      return body;
    }
    const error = body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: AuthErrorCode; message?: string } }).error
      : undefined;
    if (error?.code === "AUTH_WALLET_PENDING" && attempt === 0) {
      await pause(1_200);
      continue;
    }
    throw new PrivySessionError(error?.message ?? "StockPilot could not verify your account.", error?.code);
  }
  throw new PrivySessionError("Your Solana wallet is not ready yet. Please try again shortly.", "AUTH_WALLET_PENDING");
}
