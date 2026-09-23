"use client";

import { useEffect, useState } from "react";
import { ArrowUpRightIcon, WalletIcon } from "@/components/icons";

export function PrivyWalletCard({ address }: { address: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => setCopyState("idle"), [address]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="surface privy-wallet-card" aria-labelledby="privy-wallet-heading">
      <div className="privy-wallet-card-heading">
        <span className="privy-wallet-card-icon"><WalletIcon /></span>
        <div>
          <p className="eyebrow">Your credentials</p>
          <h2 id="privy-wallet-heading">Solana wallet</h2>
          <p>Created through Privy · Solana mainnet</p>
        </div>
      </div>
      <div className="privy-wallet-card-address">
        <span>Public wallet address</span>
        <code>{address}</code>
      </div>
      <div className="privy-wallet-card-actions">
        <button type="button" className="secondary-button" onClick={() => void copyAddress()}>
          {copyState === "copied" ? "Copied" : "Copy address"}
        </button>
        <a className="text-link" href={`https://solscan.io/account/${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer">
          View on Solscan <ArrowUpRightIcon /> <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      {copyState === "failed" && <p className="privy-wallet-copy-error" role="alert">Copy failed. Select the address above to copy it manually.</p>}
      <span className="sr-only" role="status">{copyState === "copied" ? "Wallet address copied." : ""}</span>
    </section>
  );
}
