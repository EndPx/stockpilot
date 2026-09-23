"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WalletIcon } from "@/components/icons";

export function PrivyAccountButton() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (disclosure.current && !disclosure.current.contains(event.target as Node)) disclosure.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && disclosure.current?.open) {
        disclosure.current.open = false;
        disclosure.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  if (!ready) return <span className="wallet-trigger" role="status">Checking account…</span>;
  if (!authenticated) return <Link className="wallet-trigger" href="/sign-in">Sign in</Link>;

  const email = user?.google?.email ?? user?.email?.address ?? "Privy account";
  const initials = email === "Privy account" ? "SP" : email.slice(0, 2).toUpperCase();
  const wallet = user?.linkedAccounts.find((account) =>
    account.type === "wallet" && "chainType" in account && account.chainType === "solana" &&
    "walletClientType" in account && account.walletClientType === "privy" &&
    "walletIndex" in account && account.walletIndex === 0
  );
  const address = wallet && "address" in wallet ? wallet.address : undefined;

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("StockPilot could not end the server session. Please retry.");
      await logout();
      router.replace("/sign-in");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-out failed."); }
    finally { setBusy(false); }
  }

  return (
    <details className="privy-account" ref={disclosure}>
      <summary className="privy-account-trigger" aria-label={`Account options for ${email}`}>
        <span className="privy-account-avatar" aria-hidden="true">{initials}</span>
        <span className="privy-account-label">{email}</span>
        <svg className="privy-account-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <div className="privy-account-panel">
        <p className="privy-account-caption">Signed in as</p>
        <p className="privy-account-email">{email}</p>
        {address && <p className="privy-account-wallet"><WalletIcon /> {`${address.slice(0, 4)}…${address.slice(-4)}`}</p>}
        <Link href="/app/credentials" className="privy-account-option" onClick={() => { if (disclosure.current) disclosure.current.open = false; }}>
          <WalletIcon /> View credentials
        </Link>
        <button type="button" className="privy-account-option" disabled={busy} onClick={() => void signOut()}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
        {error && <p role="alert" className="wallet-error">{error}</p>}
      </div>
    </details>
  );
}
