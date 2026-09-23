"use client";

import { useState } from "react";

export function CopyMarketAddress({ address, name }: { address: string; name: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setMessage(`${name} Solana address copied.`);
    } catch {
      setMessage("Copy unavailable. Open the product to select its full address.");
    }
  }
  return <><button type="button" onClick={copy} className="market-copy-button" aria-label={`Copy ${name} Solana address`} title="Copy Solana address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg></button><span role="status" className="sr-only">{message}</span></>;
}
