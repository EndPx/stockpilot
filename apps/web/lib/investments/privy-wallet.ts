import { InvestmentClientError } from "./client";

/** The server session, not wallet-list order, chooses the investment wallet. */
export function selectSessionWallet<T extends { address: string }>(
  wallets: readonly T[],
  sessionWalletAddress: string,
): T | null {
  const matches = wallets.filter((wallet) => wallet.address === sessionWalletAddress);
  return matches.length === 1 ? matches[0] : null;
}

export async function signWithPrivyWallet<T extends { address: string }>(input: {
  transaction: Uint8Array;
  wallet: T;
  signTransaction: (input: { transaction: Uint8Array; wallet: T }) => Promise<{ signedTransaction: Uint8Array }>;
}): Promise<Uint8Array> {
  const { signedTransaction } = await input.signTransaction({
    transaction: input.transaction,
    wallet: input.wallet,
  });
  // A raw 64-byte signature is not a signed Solana wire transaction.
  if (!(signedTransaction instanceof Uint8Array) || signedTransaction.length <= 64) {
    throw new InvestmentClientError("TRANSACTION_MISMATCH", "The wallet did not return a signed Solana transaction.");
  }
  return signedTransaction;
}
