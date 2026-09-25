import type { Portfolio } from "@stockpilot/core/portfolio";
import Link from "next/link";
import { WalletIcon } from "@/components/icons";
import { formatUsd } from "@/lib/format";

type BalanceState = { kind: "loading" } | { kind: "ready"; portfolio: Portfolio } | { kind: "error"; message: string };

export function WalletOverviewCard({ address, balance, retry }: { address: string; balance: BalanceState; retry: () => void }) {
  return <section className="surface wallet-overview" aria-labelledby="wallet-overview-heading">
    <div className="surface-header"><h2 id="wallet-overview-heading">Wallet</h2><Link href="/wallet" className="text-link">View wallet <span aria-hidden="true">↗</span></Link></div>
    {balance.kind === "ready" ? <div className="wallet-overview-value"><strong>{formatUsd(balance.portfolio.portfolioValueUsd)}</strong><span>Portfolio Estimate · indicative value, not a sale quote</span></div>
      : balance.kind === "loading" ? <div className="wallet-overview-value" role="status"><span>Loading portfolio estimate…</span></div>
        : <div className="wallet-overview-value" role="alert"><span>{balance.message}</span><button type="button" className="secondary-button" onClick={retry}>Try again</button></div>}
    <div className="wallet-overview-identity"><span className="wallet-overview-icon" aria-hidden="true"><WalletIcon /></span><div><strong>Solana wallet</strong><span>Privy · mainnet</span><code>{address}</code></div></div>
    {balance.kind === "ready" && <div className="wallet-overview-funds">
      <span>Available to Invest <strong>{formatUsd(balance.portfolio.funding.usdc.amountUsd)}</strong></span>
      <span>Network Balance <strong>{balance.portfolio.funding.sol.amount} SOL</strong></span>
    </div>}
  </section>;
}
