import "server-only";
import { address } from "@solana/kit";
import { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID } from "./config";

export class PrivyVerificationError extends Error {}

export type VerifiedPrivyWallet = { userId: string; walletAddress: string; tokenExpiresAt: number };

export function selectPrimaryEmbeddedSolanaWallet(linkedAccounts: unknown): string {
  if (!Array.isArray(linkedAccounts)) throw new PrivyVerificationError("Privy account data is invalid");
  const wallets = linkedAccounts.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" &&
    item.type === "wallet" && item.chain_type === "solana" &&
    item.wallet_client_type === "privy" && item.connector_type === "embedded" &&
    item.wallet_index === 0 && typeof item.address === "string"
  );
  if (wallets.length !== 1) throw new PrivyVerificationError("One primary embedded Solana wallet is required");
  try { return address(wallets[0].address as string).toString(); }
  catch { throw new PrivyVerificationError("Primary Solana wallet address is invalid"); }
}

export async function verifyPrivyWallet(accessToken: string): Promise<VerifiedPrivyWallet> {
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appSecret) throw new Error("Privy server configuration is unavailable");
  const client = new PrivyClient({ appId: PRIVY_APP_ID, appSecret });
  let userId: string;
  let tokenExpiresAt: number;
  try {
    const claims = await client.utils().auth().verifyAccessToken(accessToken);
    userId = claims.user_id;
    tokenExpiresAt = claims.expiration * 1000;
  } catch {
    throw new PrivyVerificationError("Invalid Privy access token");
  }
  const user = await client.users()._get(userId);
  if (user.id !== userId) throw new PrivyVerificationError("Privy user mismatch");
  return { userId, walletAddress: selectPrimaryEmbeddedSolanaWallet(user.linked_accounts), tokenExpiresAt };
}
