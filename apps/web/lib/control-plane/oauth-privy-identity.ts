import "server-only";
import { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID } from "@/lib/privy/config";
import { selectPrimaryEmbeddedSolanaWallet } from "@/lib/privy/server";

/** Resolve a verified email and re-check the current embedded wallet for Standalone Connect. */
export async function readPrivyOAuthIdentity(userId: string, expectedWallet: string): Promise<{ email: string }> {
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appSecret || !userId.startsWith("did:privy:")) throw new Error("Privy OAuth identity is unavailable");
  const privy = new PrivyClient({ appId: PRIVY_APP_ID, appSecret });
  const user = await privy.users()._get(userId);
  if (user.id !== userId || selectPrimaryEmbeddedSolanaWallet(user.linked_accounts) !== expectedWallet) {
    throw new Error("Privy wallet binding changed");
  }
  const linked = user.linked_accounts;
  const google = linked.find((entry) => entry.type === "google_oauth" && entry.verified_at > 0 && entry.email);
  const email = linked.find((entry) => entry.type === "email" && entry.verified_at > 0 && entry.address);
  const selected = google?.type === "google_oauth" ? google.email : email?.type === "email" ? email.address : null;
  if (!selected) throw new Error("A verified Privy email is required for OAuth connection");
  return { email: selected };
}
