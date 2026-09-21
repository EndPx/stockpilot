import type { WalletStatus } from "@solana/kit-plugin-wallet";
import type { AuthStatus } from "@/providers/auth-provider";

export function shouldClearMismatchedSession(
  walletStatus: WalletStatus,
  sessionWalletAddress?: string,
  connectedWalletAddress?: string,
): boolean {
  return walletStatus === "connected" &&
    Boolean(sessionWalletAddress) &&
    Boolean(connectedWalletAddress) &&
    sessionWalletAddress !== connectedWalletAddress;
}

export function authStatusForWallet(
  status: AuthStatus,
  sessionWalletAddress?: string,
  connectedWalletAddress?: string,
): AuthStatus {
  return status === "authenticated" && sessionWalletAddress !== connectedWalletAddress
    ? "loading"
    : status;
}

export async function disconnectAfterSignOut(
  signOut: () => Promise<void>,
  disconnect: () => Promise<void>,
): Promise<void> {
  await signOut();
  await disconnect();
}
