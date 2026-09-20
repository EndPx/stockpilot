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
import { solanaClient } from "@/providers/solana-provider";

export type WalletOption = Readonly<{ id: string; name: string }>;

type WalletControlViewProps = Readonly<{
  address?: string;
  reconnectingAddress?: string;
  status: WalletStatus;
  walletName?: string;
  wallets: readonly WalletOption[];
  onConnect: (walletId: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}>;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export function walletErrorMessage(action: "connect" | "disconnect"): string {
  return action === "connect"
    ? "We couldn't connect your wallet. Try again."
    : "We couldn't disconnect your wallet. Try again.";
}

function triggerLabel(status: WalletStatus, address?: string): string {
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
      return "Connect Wallet";
  }
}

export function WalletControlView({
  address,
  reconnectingAddress,
  status,
  walletName,
  wallets,
  onConnect,
  onDisconnect,
}: WalletControlViewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const busy = status === "pending" || status === "reconnecting" || status === "connecting" || status === "disconnecting";
  const connected = Boolean(address);
  const visibleAddress = status === "reconnecting" ? reconnectingAddress : address;

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

  const accessibleLabel = connected && address
    ? `Connected with ${walletName ?? "Solana wallet"}, address ${address}. Open wallet details.`
    : status === "reconnecting"
      ? `Reconnecting Solana wallet${visibleAddress ? ` ${visibleAddress}` : ""}`
      : "Connect a Solana wallet";

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
        <span>{triggerLabel(status, visibleAddress)}</span>
      </button>

      <dialog
        ref={dialogRef}
        className="wallet-dialog"
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
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
              <p className="mt-5 text-xs leading-5 text-muted">Connection makes your wallet available in this browser. It does not sign you in or authorize transactions.</p>
              {errorMessage && <p role="alert" className="wallet-error">{errorMessage}</p>}
              <button type="button" className="secondary-button mt-6 w-full" disabled={busy} onClick={disconnect}>
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
                <div className="mt-6 rounded-lg border border-line bg-slate-50 p-4">
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

export function WalletButton() {
  const [hydrated, setHydrated] = useState(false);
  const status = useWalletStatus(solanaClient);
  const wallets = useWallets(solanaClient);
  const connected = useConnectedWallet(solanaClient);
  const reconnectingAccount = useReconnectingAccount(solanaClient);
  const connectAction = useConnect(solanaClient);
  const disconnectAction = useDisconnect(solanaClient);
  const options = wallets.map((wallet, index) => ({ id: `${wallet.name}-${index}`, name: wallet.name }));

  useEffect(() => setHydrated(true), []);

  return (
    <WalletControlView
      status={hydrated ? status : "pending"}
      address={hydrated ? connected?.account.address : undefined}
      reconnectingAddress={hydrated ? reconnectingAccount?.address : undefined}
      walletName={hydrated ? connected?.wallet.name : undefined}
      wallets={hydrated ? options : []}
      onConnect={async (walletId) => {
        const index = options.findIndex((option) => option.id === walletId);
        if (index < 0) throw new Error("Wallet is no longer available");
        await connectAction.dispatchAsync(wallets[index]);
      }}
      onDisconnect={() => disconnectAction.dispatchAsync()}
    />
  );
}
