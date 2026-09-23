"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { activeNavigationSection } from "@/lib/market-navigation";
import { BrandMark } from "./brand-mark";
import { MarketsIcon, OverviewIcon, PrivateMarketsIcon, ShieldIcon, WalletIcon } from "./icons";
import { WalletButton } from "./wallet/wallet-button";
import { PrivyAccountButton } from "./privy/privy-account-button";
import { MarketLoadingIndicator } from "./market-loading-indicator";
import { isPrivyMode } from "@/lib/privy/config";

const navigation = [
  { href: "/app", label: "Overview", icon: OverviewIcon, section: "overview" },
  { href: "/markets?group=private", label: "Private Markets", icon: PrivateMarketsIcon, section: "private" },
  { href: "/markets?group=public", label: "Public Markets", icon: MarketsIcon, section: "public" },
];
const credentialsNavigation = { href: "/app/credentials", label: "Credentials", icon: WalletIcon, section: "credentials" };

function MarketNavigationStatus({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return pending ? <div className="market-navigation-pending"><MarketLoadingIndicator label={`Loading ${label}`} /></div> : null;
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link href="/" className={inverse ? "brand brand-inverse" : "brand"} aria-label="StockPilot home">
      <BrandMark />
      <span>StockPilot</span>
    </Link>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const landing = pathname === "/";
  if (pathname === "/sign-in") return <>{children}</>;
  const privy = isPrivyMode();
  const appNavigation = privy ? [navigation[0], credentialsNavigation, ...navigation.slice(1)] : navigation;
  const activeSection = activeNavigationSection(pathname, searchParams.get("group"));

  if (landing) {
    return (
      <div className="landing-shell">
        <a href="#main" className="skip-link">Skip to content</a>
        <header className="landing-header">
          <Brand inverse />
          <Link href="/app" className="landing-open-app">Open the app <span aria-hidden="true">↗</span></Link>
        </header>
        <main id="main">{children}</main>
        <footer className="landing-footer">
          <Brand />
          <p>Tokenized-stock exposure, not direct share ownership. Investing involves risk; issuer and jurisdiction restrictions apply.</p>
          <span>Solana mainnet</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="app-sidebar">
        <Brand />
        <nav aria-label="App navigation" className="sidebar-nav">
          {appNavigation.map(({ href, label, icon: Icon, section }) => {
            const active = activeSection === section;
            return (
              <Link key={href} href={href} prefetch={section === "public" ? false : undefined} aria-label={label} aria-current={active ? "page" : undefined} className={active ? "sidebar-link sidebar-link-active" : "sidebar-link"}>
                <Icon className="nav-icon" />
                <span>{label}</span>
                {(section === "private" || section === "public") && <MarketNavigationStatus label={label} />}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-assurance">
          <ShieldIcon className="nav-icon" />
          {privy
            ? <div><strong>Read-only migration</strong><span>Trading and agent access are off</span></div>
            : <div><strong>Human approval</strong><span>Required for every buy</span></div>}
        </div>
        <div className="sidebar-wallet">{privy ? <PrivyAccountButton /> : <WalletButton />}</div>
      </aside>

      <header className="mobile-app-header">
        <Brand />
        {privy ? <PrivyAccountButton /> : <WalletButton />}
      </header>

      <main id="main" className="app-main">{children}</main>

      <nav className={privy ? "mobile-bottom-nav mobile-bottom-nav-four" : "mobile-bottom-nav"} aria-label="Mobile app navigation">
        {appNavigation.map(({ href, label, icon: Icon, section }) => {
          const active = activeSection === section;
          return (
            <Link key={href} href={href} prefetch={section === "public" ? false : undefined} aria-label={label} aria-current={active ? "page" : undefined} className={active ? "mobile-nav-link mobile-nav-link-active" : "mobile-nav-link"}>
              <Icon className="nav-icon" />
              <span>{label}</span>
              {(section === "private" || section === "public") && <MarketNavigationStatus label={label} />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
