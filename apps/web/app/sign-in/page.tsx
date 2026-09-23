import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SignInForm } from "@/components/privy/sign-in-form";
import { isPrivyMode } from "@/lib/privy/config";
import { isAuthEnabled } from "@/lib/auth/config";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  const active = isPrivyMode() && Boolean(process.env.PRIVY_APP_SECRET) && isAuthEnabled();
  return (
    <div className="sign-in-shell">
      <aside className="sign-in-art" aria-label="StockPilot introduction">
        <Image src="/images/stockpilot-orbital.png" alt="" fill sizes="(max-width: 800px) 100vw, 40vw" priority className="sign-in-art-image" />
        <Link href="/" className="sign-in-brand"><BrandMark /><span>StockPilot</span></Link>
        <div className="sign-in-art-copy"><p>THE NEXT MARKET FRONTIER</p><h2>Markets move.<br />You stay in control.</h2><span>Discover tokenized public and private market exposure on Solana.</span></div>
      </aside>
      <main id="main" className="sign-in-main">
        <Link href="/" className="sign-in-back">← Back to StockPilot</Link>
        {active ? <SignInForm /> : (
          <div className="sign-in-form"><p className="sign-in-kicker">Coming online</p><h1>Privy sign-in is not active yet.</h1><p className="sign-in-subtitle">The secure server configuration is not complete. Markets remain available without signing in.</p><Link className="sign-in-primary" href="/markets">Explore markets</Link></div>
        )}
        <p className="sign-in-footnote">{active ? "Protected by Privy. Investment actions require separate authorization." : "Login and trading remain off until server configuration is complete."}</p>
      </main>
    </div>
  );
}
