"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exchangePrivySession } from "@/lib/privy/client-session";

export function SignInForm() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const inFlight = useRef(false);

  async function exchange() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("verifying");
    setErrorMessage("");
    try {
      await exchangePrivySession(getAccessToken);
      router.replace("/app");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Sign-in failed. Please try again.");
      setStatus("error");
    } finally { inFlight.current = false; }
  }

  useEffect(() => {
    if (ready && authenticated) void exchange();
    // A successful Privy login is the only automatic exchange trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated]);

  const busy = !ready || status === "verifying";
  if (authenticated) return (
    <div className="sign-in-form">
      <p className="sign-in-kicker">Secure access</p>
      <h1>Finishing sign-in.</h1>
      <p className="sign-in-subtitle">Verifying your Privy account and Solana wallet.</p>
      {status === "error" && <><p className="sign-in-error" role="alert">{errorMessage}</p><button className="sign-in-primary" onClick={() => void exchange()}>Try again</button></>}
    </div>
  );

  return (
    <div className="sign-in-form">
      <p className="sign-in-kicker">Secure access</p>
      <h1>Sign in to StockPilot.</h1>
      <p className="sign-in-subtitle">Your markets, portfolio and future agent controls in one place.</p>
      <button type="button" className="sign-in-social" disabled={busy} onClick={() => login({ loginMethods: ["google"] })}>
        <span className="google-g" aria-hidden="true">G</span> Continue with Google
      </button>
      <div className="sign-in-divider"><span>or use email</span></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        login({ loginMethods: ["email"], prefill: { type: "email", value: email } });
      }}>
        <label htmlFor="sign-in-email">Email address</label>
        <input id="sign-in-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} />
        <button type="submit" className="sign-in-primary" disabled={busy || !email.trim()}>Continue with email</button>
      </form>
      {status === "error" && <p className="sign-in-error" role="alert">{errorMessage}</p>}
      <p className="sign-in-note">Signing in creates a separate Privy Solana wallet if you do not already have one. It does not move funds from Phantom or authorize trading.</p>
    </div>
  );
}
