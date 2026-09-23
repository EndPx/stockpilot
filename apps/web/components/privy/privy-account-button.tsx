"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PrivyAccountButton() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!ready) return <span className="wallet-trigger" role="status">Checking account…</span>;
  if (!authenticated) return <Link className="wallet-trigger" href="/sign-in">Sign in</Link>;

  const wallet = user?.linkedAccounts.find((account) =>
    account.type === "wallet" && "chainType" in account && account.chainType === "solana" &&
    "walletClientType" in account && account.walletClientType === "privy" &&
    "walletIndex" in account && account.walletIndex === 0
  );
  const address = wallet && "address" in wallet ? wallet.address : undefined;
  return (
    <div className="privy-account">
      <span className="privy-account-address" title={address}>{address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Solana wallet pending"}</span>
      <button type="button" className="privy-signout" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch("/api/auth/logout", { method: "POST" });
          if (!response.ok) throw new Error("StockPilot could not end the server session. Please retry.");
          await logout();
          router.replace("/sign-in");
          router.refresh();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-out failed."); }
        finally { setBusy(false); }
      }}>{busy ? "Signing out…" : "Sign out"}</button>
      {error && <span role="alert" className="wallet-error">{error}</span>}
    </div>
  );
}
