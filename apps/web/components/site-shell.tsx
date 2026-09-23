"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { activeNavigationSection } from "@/lib/market-navigation";
import { BrandMark } from "./brand-mark";
import { MarketsIcon, OverviewIcon, PrivateMarketsIcon, ShieldIcon } from "./icons";
import { WalletButton } from "./wallet/wallet-button";

const navigation = [
  { href: "/app", label: "Overview", icon: OverviewIcon, section: "overview" },
  { href: "/markets?group=private", label: "Private Markets", icon: PrivateMarketsIcon, section: "private" },
  { href: "/markets?group=public", label: "Public Markets", icon: MarketsIcon, section: "public" },
];

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
          {navigation.map(({ href, label, icon: Icon, section }) => {
            const active = activeSection === section;
            return (
              <Link key={href} href={href} prefetch={section === "public" ? false : undefined} aria-current={active ? "page" : undefined} className={active ? "sidebar-link sidebar-link-active" : "sidebar-link"}>
                <Icon className="nav-icon" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-assurance">
          <ShieldIcon className="nav-icon" />
          <div><strong>Human approval</strong><span>Required for every buy</span></div>
        </div>
        <div className="sidebar-wallet"><WalletButton /></div>
      </aside>

      <header className="mobile-app-header">
        <Brand />
        <WalletButton />
      </header>

      <main id="main" className="app-main">{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Mobile app navigation">
        {navigation.map(({ href, label, icon: Icon, section }) => {
          const active = activeSection === section;
          return (
            <Link key={href} href={href} prefetch={section === "public" ? false : undefined} aria-current={active ? "page" : undefined} className={active ? "mobile-nav-link mobile-nav-link-active" : "mobile-nav-link"}>
              <Icon className="nav-icon" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
