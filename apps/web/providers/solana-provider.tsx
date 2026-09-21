"use client";

import { createClient } from "@solana/kit";
import { walletWithoutSigner } from "@solana/kit-plugin-wallet";
import { ClientProvider } from "@solana/react";
import type { ReactNode } from "react";
import { SOLANA_CHAIN, WALLET_STORAGE_KEY } from "@/lib/solana/config";
import { AuthProvider } from "@/providers/auth-provider";

export const solanaClient = createClient().use(
  walletWithoutSigner({
    chain: SOLANA_CHAIN,
    autoConnect: true,
    storageKey: WALLET_STORAGE_KEY,
  }),
);

export type StockPilotSolanaClient = typeof solanaClient;

export function SolanaProvider({ children }: { children: ReactNode }) {
  return (
    <ClientProvider client={solanaClient}>
      <AuthProvider client={solanaClient}>{children}</AuthProvider>
    </ClientProvider>
  );
}
