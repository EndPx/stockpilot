"use client";

import { useState } from "react";

export function CopyMint({ mint }: { mint: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(mint);
      setStatus("Mint address copied.");
    } catch {
      setStatus("Copy unavailable. Select and copy the mint address above.");
    }
  }
  return <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={copy} className="secondary-button" aria-label="Copy mint address">Copy</button><span role="status" className="text-xs text-muted">{status}</span></div>;
}
