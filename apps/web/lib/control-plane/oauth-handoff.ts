import type { AuthSessionToken } from "@/lib/auth/types";
import { createSignedToken, readSignedToken } from "@/lib/auth/tokens";

const HANDOFF_TTL_MS = 5 * 60_000;

export async function createOAuthHandoffProof(
  externalAuthId: string,
  session: AuthSessionToken,
  secret: string,
  now = Date.now(),
): Promise<string> {
  if (session.authProvider !== "privy" || !session.privyUserId || session.expiresAt <= now) {
    throw new Error("A current Privy session is required for OAuth handoff.");
  }
  return createSignedToken({
    kind: "oauth-connect-handoff",
    externalAuthId,
    sessionId: session.sessionId,
    walletAddress: session.walletAddress,
    privyUserId: session.privyUserId,
    issuedAt: now,
    expiresAt: Math.min(now + HANDOFF_TTL_MS, session.expiresAt),
  }, secret);
}

/** A handoff is a short-lived page-to-submit binding, never an OAuth grant. */
export async function verifyOAuthHandoffProof(
  proof: string,
  externalAuthId: string,
  session: AuthSessionToken,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  try {
    const value = await readSignedToken(proof, secret);
    if (!value || typeof value !== "object") return false;
    const handoff = value as Record<string, unknown>;
    return handoff.kind === "oauth-connect-handoff" &&
      handoff.externalAuthId === externalAuthId &&
      handoff.sessionId === session.sessionId &&
      handoff.walletAddress === session.walletAddress &&
      handoff.privyUserId === session.privyUserId &&
      typeof handoff.issuedAt === "number" && Number.isFinite(handoff.issuedAt) &&
      typeof handoff.expiresAt === "number" && Number.isFinite(handoff.expiresAt) &&
      handoff.issuedAt <= now && handoff.expiresAt > now &&
      handoff.expiresAt <= handoff.issuedAt + HANDOFF_TTL_MS &&
      handoff.expiresAt <= session.expiresAt;
  } catch {
    return false;
  }
}
