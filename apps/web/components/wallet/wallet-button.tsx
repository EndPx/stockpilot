"use client";

import type { WalletStatus } from "@solana/kit-plugin-wallet";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useReconnectingAccount,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useEffect, useId, useRef, useState } from "react";
import { shortenAddress } from "@/lib/solana/address";
import { SOLANA_NETWORK_LABEL } from "@/lib/solana/config";
import { authStatusForWallet, disconnectAfterSignOut } from "@/lib/auth/client-state";
import type { AuthStatus } from "@/providers/auth-provider";
import { useAuth } from "@/providers/auth-provider";
import { solanaClient } from "@/providers/solana-provider";

export type WalletOption = Readonly<{ id: string; name: string }>;

type WalletControlViewProps = Readonly<{
  address?: string;
  reconnectingAddress?: string;
  status: WalletStatus;
  walletName?: string;
  wallets: readonly WalletOption[];
  authErrorMessage?: string;
  authStatus: AuthStatus;
  authWalletAddress?: string;
  disconnectedLabel?: string;
  onConnect: (walletId: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}>;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export function walletErrorMessage(action: "connect" | "disconnect"): string {
  return action === "connect"
    ? "We couldn't connect your wallet. Try again."
    : "We couldn't disconnect your wallet. Try again.";
}

function triggerLabel(status: WalletStatus, address?: string, disconnectedLabel = "Connect Wallet"): string {
  switch (status) {
    case "pending":
      return "Checking wallet…";
    case "reconnecting":
      return address ? shortenAddress(address) : "Reconnecting…";
    case "connecting":
      return "Connecting…";
    case "disconnecting":
      return "Disconnecting…";
    case "connected":
      return address ? shortenAddress(address) : "Connected";
    default:
      return disconnectedLabel;
  }
}

export function WalletControlView({
  address,
  reconnectingAddress,
  status,
  walletName,
  wallets,
  authErrorMessage,
  authStatus,
  authWalletAddress,
  disconnectedLabel,
  onConnect,
  onDisconnect,
  onSignIn,
  onSignOut,
}: WalletControlViewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const walletBusy = status === "pending" || status === "reconnecting" || status === "connecting" || status === "disconnecting";
  const authBusy = authStatus === "authenticating" || authStatus === "signingOut";
  const busy = walletBusy || authBusy;
  const connected = Boolean(address);
  const visibleAddress = status === "reconnecting" ? reconnectingAddress : address;
  const authenticated = authStatus === "authenticated" && authWalletAddress === address;
  const sessionForWallet = authWalletAddress === address &&
    (authStatus === "authenticated" || authStatus === "signingOut");

  function openDialog() {
    setErrorMessage(undefined);
    dialogRef.current?.showModal();
    setDialogOpen(true);
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function connect(walletId: string) {
    setErrorMessage(undefined);
    try {
      await onConnect(walletId);
      closeDialog();
    } catch (error) {
      if (!isAbortError(error)) setErrorMessage(walletErrorMessage("connect"));
    }
  }

  async function disconnect() {
    setErrorMessage(undefined);
    try {
      await onDisconnect();
      closeDialog();
    } catch (error) {
      if (!isAbortError(error)) setErrorMessage(walletErrorMessage("disconnect"));
    }
  }

  async function signIn() {
    setErrorMessage(undefined);
    try {
      await onSignIn();
    } catch (error) {
      if (isAbortError(error)) return;
    }
  }

  async function signOut() {
    setErrorMessage(undefined);
    try {
      await onSignOut();
    } catch (error) {
      if (isAbortError(error)) return;
    }
  }

  const visibleLabel = triggerLabel(status, visibleAddress, disconnectedLabel);
  const accessibleLabel = connected && address
    ? `${visibleLabel}. Connected with ${walletName ?? "Solana wallet"}, address ${address}${authenticated ? ", signed in to StockPilot" : ""}. Open wallet details.`
    : status === "reconnecting"
      ? `${visibleLabel}. Reconnecting Solana wallet${visibleAddress ? ` ${visibleAddress}` : ""}`
      : `${visibleLabel} — opens the Solana wallet selector`;

  return (
    <div className="wallet-control">
      <button
        ref={triggerRef}
        type="button"
        className={connected ? "wallet-trigger wallet-trigger-connected" : "wallet-trigger"}
        aria-label={accessibleLabel}
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        aria-busy={busy}
        disabled={busy}
        onClick={openDialog}
      >
        <span aria-hidden="true" className={connected ? "wallet-dot wallet-dot-connected" : "wallet-dot"} />
        <span>{visibleLabel}</span>
      </button>

      <dialog
        ref={dialogRef}
        className="wallet-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          setDialogOpen(false);
          triggerRef.current?.focus();
        }}
      >
        <div className="relative p-6 sm:p-7">
          <button type="button" className="wallet-dialog-close" aria-label="Close wallet dialog" onClick={closeDialog}>×</button>
          {connected && address ? (
            <>
              <p className="wallet-dialog-kicker">Connected wallet</p>
              <h2 id={titleId} className="wallet-dialog-title">{walletName ?? "Solana wallet"}</h2>
              <dl className="mt-6 grid gap-4 text-sm">
                <div>
                  <dt className="text-muted">Address</dt>
                  <dd className="mt-1 break-all font-medium">{address}</dd>
                </div>
                <div>
                  <dt className="text-muted">Network</dt>
                  <dd className="mt-1 font-medium">{SOLANA_NETWORK_LABEL}</dd>
                </div>
              </dl>
              <section className="wallet-auth-panel" aria-label="StockPilot authentication">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">StockPilot session</p>
                    <p className="mt-1 text-sm font-semibold">
                      {authenticated
                        ? "Signed in"
                        : authStatus === "loading"
                          ? "Checking session…"
                          : authStatus === "authenticating"
                            ? "Waiting for signature…"
                            : authStatus === "signingOut"
                              ? "Signing out…"
                              : "Not signed in"}
                    </p>
                  </div>
                  <span aria-hidden="true" className={authenticated ? "auth-dot auth-dot-active" : "auth-dot"} />
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">
                  {authenticated
                    ? "This browser session is bound to the connected wallet."
                    : "Sign a non-transactional message to prove you control this wallet."}
                </p>
                {authErrorMessage && <p role="alert" className="wallet-error">{authErrorMessage}</p>}
                {sessionForWallet ? (
                  <button type="button" className="secondary-button mt-4 w-full" disabled={busy} onClick={() => void signOut()}>
                    {authStatus === "signingOut" ? "Signing out…" : "Sign out"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button mt-4 w-full"
                    disabled={busy || authStatus === "loading" || authStatus === "authenticated"}
                    onClick={() => void signIn()}
                  >
                    {authStatus === "authenticating"
                      ? "Waiting for signature…"
                      : authStatus === "error"
                        ? "Try signing in again"
                        : "Sign in to StockPilot"}
                  </button>
                )}
              </section>
              <p className="mt-5 text-xs leading-5 text-muted">Signing in proves wallet ownership only. It does not authorize transactions or asset transfers.</p>
              {errorMessage && <p role="alert" className="wallet-error">{errorMessage}</p>}
              <button type="button" className="secondary-button mt-5 w-full" disabled={busy} onClick={() => void disconnect()}>
                {status === "disconnecting" ? "Disconnecting…" : "Disconnect"}
              </button>
            </>
          ) : (
            <>
              <p className="wallet-dialog-kicker">Solana wallet</p>
              <h2 id={titleId} className="wallet-dialog-title">Connect to StockPilot</h2>
              <p className="mt-2 pr-8 text-sm leading-6 text-muted">Choose an installed Wallet Standard wallet. Connecting does not sign a message or transaction.</p>
              {wallets.length > 0 ? (
                <div className="mt-6 grid gap-2">
                  {wallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      className="wallet-option"
                      disabled={busy}
                      onClick={() => void connect(wallet.id)}
                    >
                      <span className="wallet-option-mark" aria-hidden="true">{wallet.name.slice(0, 1).toUpperCase()}</span>
                      <span>Connect {wallet.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-6 rounded-lg border border-line bg-raised p-4">
                  <p className="text-sm font-medium">No compatible wallet found</p>
                  <p className="mt-1 text-sm leading-6 text-muted">Install a Wallet Standard compatible Solana wallet, then reload this page.</p>
                </div>
              )}
              {errorMessage && <p role="alert" className="wallet-error">{errorMessage}</p>}
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

export function WalletButton({ disconnectedLabel }: { disconnectedLabel?: string } = {}) {
  const [hydrated, setHydrated] = useState(false);
  const status = useWalletStatus(solanaClient);
  const wallets = useWallets(solanaClient);
  const connected = useConnectedWallet(solanaClient);
  const reconnectingAccount = useReconnectingAccount(solanaClient);
  const connectAction = useConnect(solanaClient);
  const disconnectAction = useDisconnect(solanaClient);
  const auth = useAuth();
  const options = wallets.map((wallet, index) => ({ id: `${wallet.name}-${index}`, name: wallet.name }));
  const address = hydrated ? connected?.account.address : undefined;
  const authStatus = authStatusForWallet(auth.status, auth.sessionWalletAddress, address);

  useEffect(() => setHydrated(true), []);

  return (
    <WalletControlView
      status={hydrated ? status : "pending"}
      address={address}
      reconnectingAddress={hydrated ? reconnectingAccount?.address : undefined}
      walletName={hydrated ? connected?.wallet.name : undefined}
      wallets={hydrated ? options : []}
      authErrorMessage={auth.errorMessage}
      authStatus={authStatus}
      authWalletAddress={auth.sessionWalletAddress}
      disconnectedLabel={disconnectedLabel}
      onConnect={async (walletId) => {
        const index = options.findIndex((option) => option.id === walletId);
        if (index < 0) throw new Error("Wallet is no longer available");
        await connectAction.dispatchAsync(wallets[index]);
      }}
      onDisconnect={async () => {
        await disconnectAfterSignOut(auth.signOut, () => disconnectAction.dispatchAsync());
      }}
      onSignIn={auth.signIn}
      onSignOut={auth.signOut}
    />
  );
}
