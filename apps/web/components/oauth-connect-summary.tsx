import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { ArrowUpRightIcon, CheckIcon, ShieldIcon, WalletIcon } from "./icons";

export function OAuthConnectSummary({ externalAuthId, walletAddress, handoffProof }: {
  externalAuthId: string;
  walletAddress: string;
  handoffProof: string;
}) {
  return <div className="oauth-connect-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="oauth-connect-header">
      <Link href="/" className="brand" aria-label="StockPilot home"><BrandMark /><span>StockPilot</span></Link>
      <Link href="/clients" className="oauth-connect-back">Back to Agents</Link>
    </header>
    <main id="main" className="oauth-connect-main"><OAuthConnectContent externalAuthId={externalAuthId} walletAddress={walletAddress} handoffProof={handoffProof} /></main>
  </div>;
}

export function OAuthConnectContent({ externalAuthId, walletAddress, handoffProof }: {
  externalAuthId: string;
  walletAddress: string;
  handoffProof: string;
}) {
  return <>
      <p className="oauth-connect-kicker">Secure connection</p>
      <h1>Connect an AI app</h1>
      <p className="oauth-connect-intro">Review the wallet this connection can access. Check the AI app name, origin, and grant on the WorkOS consent screen before allowing access.</p>

      <section aria-labelledby="connect-wallet-heading" className="oauth-connect-section">
        <div className="oauth-connect-section-heading"><span>01 / Wallet</span><h2 id="connect-wallet-heading">Your StockPilot wallet</h2></div>
        <div className="oauth-connect-wallet">
          <span className="oauth-connect-icon"><WalletIcon aria-hidden="true" /></span>
          <div><strong>Solana wallet</strong><span>Primary wallet verified by your StockPilot session</span><code>{walletAddress}</code></div>
          <span className="oauth-connect-selected"><CheckIcon aria-hidden="true" /><span className="sr-only">Selected</span></span>
        </div>
      </section>

      <section aria-labelledby="connect-access-heading" className="oauth-connect-section">
        <div className="oauth-connect-section-heading"><span>02 / Access</span><h2 id="connect-access-heading">Agent permissions</h2></div>
        <div className="oauth-connect-access">
          <span className="oauth-connect-icon"><ShieldIcon aria-hidden="true" /></span>
          <div><strong>New agents start with market read access</strong><span>Existing permissions may carry over when an agent reconnects. Review its effective access in Agents Settings after connecting; this screen cannot reset prior grants.</span></div>
        </div>
      </section>

      <form action="/api/oauth/authorize" method="post" className="oauth-connect-form">
        <input type="hidden" name="external_auth_id" value={externalAuthId} />
        <input type="hidden" name="handoff" value={handoffProof} />
        <button type="submit" className="oauth-connect-submit">Continue with WorkOS <ArrowUpRightIcon aria-hidden="true" /></button>
      </form>
      <p className="oauth-connect-note">Connecting does not sign a transaction. WorkOS handles final OAuth consent and returns you to your AI app. Any existing agent permissions remain in effect.</p>
  </>;
}

export function OAuthConnectUnavailable() {
  return <div className="oauth-connect-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="oauth-connect-header">
      <Link href="/" className="brand" aria-label="StockPilot home"><BrandMark /><span>StockPilot</span></Link>
      <Link href="/clients" className="oauth-connect-back">Back to Agents</Link>
    </header>
    <main id="main" className="oauth-connect-main">
      <p className="oauth-connect-kicker">Connection unavailable</p>
      <h1>Start a new connection</h1>
      <p className="oauth-connect-intro">This connection request is invalid, expired, or could not be completed. Return to your AI app and choose Authenticate again to start a fresh OAuth flow.</p>
      <Link href="/clients" className="oauth-connect-submit">Back to Agents</Link>
    </main>
  </div>;
}
