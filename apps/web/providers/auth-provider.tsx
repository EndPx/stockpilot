"use client";

import { createSignInMessage } from "@solana/wallet-standard-util";
import { useConnectedWallet, useSignIn, useSignMessage, useWalletStatus } from "@solana/kit-plugin-wallet/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthSession, AuthSignInInput, AuthVerifyRequest } from "@/lib/auth/types";
import { shouldClearMismatchedSession } from "@/lib/auth/client-state";
import type { StockPilotSolanaClient } from "./solana-provider";

export type AuthStatus = "loading" | "unauthenticated" | "authenticating" | "authenticated" | "signingOut" | "error";

type AuthContextValue = {
  errorMessage?: string;
  sessionWalletAddress?: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  status: AuthStatus;
};

const AuthContext = createContext<AuthContextValue | null>(null);

class SafeAuthError extends Error {}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as
    | T
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && body.error?.message
      ? body.error.message
      : "StockPilot could not complete authentication. Try again.";
    throw new SafeAuthError(message);
  }
  return body as T;
}

function serializeOutput(
  account: { address: string; publicKey: ArrayLike<number> },
  signedMessage: ArrayLike<number>,
  signature: ArrayLike<number>,
  signatureType?: "ed25519",
): AuthVerifyRequest["output"] {
  return {
    account: {
      address: account.address,
      publicKey: encodeBase64Url(new Uint8Array(account.publicKey)),
    },
    signedMessage: encodeBase64Url(new Uint8Array(signedMessage)),
    signature: encodeBase64Url(new Uint8Array(signature)),
    signatureType,
  };
}

export function AuthProvider({
  children,
  client,
}: {
  children: ReactNode;
  client: StockPilotSolanaClient;
}) {
  const connected = useConnectedWallet(client);
  const walletStatus = useWalletStatus(client);
  const signInAction = useSignIn(client);
  const signMessageAction = useSignMessage(client);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AuthSession>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const previousConnectedAddress = useRef<string | undefined>(undefined);

  const clearServerSession = useCallback(async (showPending: boolean) => {
    if (showPending) setStatus("signingOut");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      await readApiResponse<{ authenticated: false }>(response);
      setSession(undefined);
      setErrorMessage(undefined);
      setStatus("unauthenticated");
    } catch (error) {
      setErrorMessage("We couldn't clear your StockPilot session. Try again.");
      setStatus((current) => current === "signingOut" ? "authenticated" : "error");
      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;

    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return { authenticated: false } as const;
        return readApiResponse<AuthSession | { authenticated: false }>(response);
      })
      .then((result) => {
        if (!active) return;
        if (result.authenticated) {
          setSession(result);
          setStatus("authenticated");
        } else {
          setStatus("unauthenticated");
        }
      })
      .catch(() => {
        if (!active) return;
        setErrorMessage("We couldn't check your StockPilot session. You can try signing in again.");
        setStatus("error");
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const address = connected?.account.address;
    if (walletStatus === "connected" && address) {
      previousConnectedAddress.current = address;
      if (shouldClearMismatchedSession(walletStatus, session?.walletAddress, address)) {
        void clearServerSession(false).catch(() => {
          setSession(undefined);
          setErrorMessage("The previous wallet session could not be cleared. Try again.");
          setStatus("error");
        });
      }
      return;
    }

    if (walletStatus === "disconnected" && previousConnectedAddress.current) {
      previousConnectedAddress.current = undefined;
      void clearServerSession(false).catch(() => {
        setSession(undefined);
        setStatus("unauthenticated");
      });
    }
  }, [clearServerSession, connected?.account.address, session, walletStatus]);

  const signIn = useCallback(async () => {
    if (!connected) throw new Error("Connect a wallet before signing in.");
    setStatus("authenticating");
    setErrorMessage(undefined);

    try {
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connected.account.address }),
      });
      const { input } = await readApiResponse<{ input: AuthSignInInput }>(challengeResponse);
      let method: AuthVerifyRequest["method"];
      let output: AuthVerifyRequest["output"];

      if (connected.wallet.features.includes("solana:signIn")) {
        const result = await signInAction.dispatchAsync(connected.wallet, input);
        method = "signIn";
        output = serializeOutput(result.account, result.signedMessage, result.signature, result.signatureType);
      } else if (connected.account.features.includes("solana:signMessage")) {
        const message = createSignInMessage(input);
        const signature = await signMessageAction.dispatchAsync(message);
        method = "signMessage";
        output = serializeOutput(connected.account, message, signature, "ed25519");
      } else {
        throw new SafeAuthError("This wallet cannot sign the ownership message required by StockPilot.");
      }

      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, requestId: input.requestId, output } satisfies AuthVerifyRequest),
      });
      const authenticated = await readApiResponse<AuthSession>(verifyResponse);
      setSession(authenticated);
      setStatus("authenticated");
    } catch (error) {
      setSession(undefined);
      setErrorMessage(error instanceof SafeAuthError
        ? error.message
        : isAbortError(error)
          ? "The signature request was cancelled. Try again when you're ready."
          : "StockPilot could not complete authentication. Try again.");
      setStatus("error");
      throw error;
    }
  }, [connected, signInAction, signMessageAction]);

  const signOut = useCallback(() => clearServerSession(true), [clearServerSession]);
  const value = useMemo<AuthContextValue>(() => ({
    errorMessage,
    sessionWalletAddress: session?.walletAddress,
    signIn,
    signOut,
    status,
  }), [errorMessage, session?.walletAddress, signIn, signOut, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
