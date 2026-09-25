# StockPilot

StockPilot is an agent-native tokenized-stock application on Solana. It separates
Stocks (official xStocks) from Pre-IPO (official PreStocks), reads real wallet
balances, and provides owner-signed manual trades plus explicitly delegated
agent wallet actions. Signing in or connecting an MCP client does not grant
spending authority.

## Current status

As of 25 September 2026, the repository implements:

- Privy sign-in, a verified embedded Solana wallet, SOL/USDC balances, and
  canonical Stocks/Pre-IPO holdings with source-labeled indicative valuation.
- Separate MCP market tools, portfolio/balance reads, WorkOS OAuth connections,
  owner-managed agents, and durable request/approval/activity records in Neon.
- Manual BUY and SELL for **Polymarket PreStocks and AAPLx only**, for the
  configured demo wallet. The owner chooses the amount and signs each trade.
- Agent BUY, SELL, SOL transfer, and USDC transfer behind separate owner opt-ins,
  per-agent limits, explicit wallet delegation, and durable single-send recovery.

Release `e5b53a2` is deployed to the StockPilot app container and verified healthy;
`investmentsEnabled` and `agentExecutionEnabled` are both true. The live agent
page confirms that wallet automation still requires the owner's consent and
that its initial execution policy grants no actions. This release also fixes
the missing Privy mainnet RPC configuration and embedded-wallet readiness,
permits only the SDK's exact wallet-catalogue path in CSP, and removes the
separate candle-inspection bar. The live manual BUY/SELL form loads normally.
No real finalized BUY, SELL, or agent transfer has been verified in the current acceptance record.
Passing tests, a quote, or an enabled health flag is not evidence of a completed
mainnet transaction. See [current wallet-execution boundary and test handoff](docs/AGENT_WALLET_EXECUTION.md)
for the exact opt-ins, supported assets, six-day server authorization, and
remaining acceptance work.

The web application reads live provider data. Prices and the available asset registry can change between requests.

## Product boundary

Discovery supports official PreStocks plus `PUBLIC_EQUITY`, `ETF`, and
unclassified `PUBLIC_MARKET_PRODUCT` from the canonical xStocks catalog, never
arbitrary SPL tokens. **All pre-IPO/private-company exposure remains exclusively
PreStocks.** The executable demo is a narrower, two-product allowlist; listing a
product does not make it tradable or establish investor eligibility.

The manual investment path is:

```text
Owner chooses BUY or SELL and an exact amount
    ↓
StockPilot resolves the supported issuer mint and wallet balances
    ↓
Jupiter builds a route; StockPilot verifies its transaction effects
    ↓
Owner reviews and signs with the matching Privy wallet
    ↓
One submission attempt → finalized Solana reconciliation
```

BUY spends canonical mainnet USDC; SELL spends the selected token and receives
USDC. There is no hidden $0.10 application cap: balances, representable exact
amounts, route availability, fees/rent, and transaction verification still apply.
Agent execution additionally needs an owner-saved execution policy and a live
Privy wallet delegation. Legacy approval requests remain consent records, not a
signing or execution mechanism.

Jupiter is infrastructure behind an investment-specific experience; StockPilot is not a generic DEX or Jupiter interface. Non-PreStocks pre-IPO tokens and custom StockPilot-wrapped assets are outside the product scope. Meteora may appear as a venue chosen inside a Jupiter route.

## Architecture

```text
Official PreStocks and xStocks catalogs
    ↓
packages/integrations  — fetches and normalizes issuer registries and routes
    ↓
packages/core          — canonical assets, bounded cache, and portfolio domain service
    ↓
apps/web               — Next.js UI, authenticated APIs/MCP, and Solana adapter

src                    — Phase 1 Solana and Jupiter validation path
```

The web application and the Phase 1 validator share provider integrations.
Discovery caches identify stale results; execution requests a fresh issuer
snapshot and refuses data older than its independent 60-second bound. Redis
stores revocable sessions and transient state; Neon/PostgreSQL stores agent
policies, approvals, and manual/agent execution ledgers. Privy provides owner
authentication and wallet signing; WorkOS provides managed MCP OAuth.

The new `InvestmentAssetRegistry` is a provider-aware foundation with namespaced
mint-based IDs, runtime classification checks and availability review metadata.
The existing `AssetService` remains the PreStocks-only compatibility path. See
[product architecture](docs/PRODUCT_ARCHITECTURE.md) for the staged migration.

## Requirements

- Node.js 20.9 or newer
- pnpm 10

## Run locally

```bash
pnpm install
pnpm dev
```

Copy `apps/web/.env.example` to `apps/web/.env.local`, set a strong
`SESSION_SECRET`, and keep `APP_URL` aligned with the origin you open. Next.js
loads the web runtime environment from `apps/web`; a root-only `.env.local` is
not used by `pnpm dev`. The default public Solana mainnet RPC works for
development; set the server-only `SOLANA_RPC_URL` when using a dedicated
endpoint. Never expose it as a `NEXT_PUBLIC_` variable.

The environment example retains legacy SIWS/read-only defaults. To reproduce
the current Privy UI, configure `NEXT_PUBLIC_AUTH_PROVIDER=privy`,
`AUTH_ENABLED=true`, and the appropriate server-side Privy, Redis, and Neon
settings. Do not copy production secrets into examples or source control.
Open `http://localhost:3000` and use **Open the app**. In Privy mode, application
pages require sign-in; public read-only market APIs have a separate contract.
Keep trading flags off until the execution configuration and migrations are
deliberately prepared; the [execution handoff](docs/AGENT_WALLET_EXECUTION.md)
distinguishes operator readiness from owner authorization.

Restart `pnpm dev` after pulling provider/domain changes: per-process provider
singletons survive hot reload and can retain old normalizer implementations.

The legacy SIWS mode discovers compatible installed Wallet Standard wallets.
It is not the Privy manual/agent execution path described above.

`PRESTOCKS_API_URL` can override the live registry for local testing.
`SESSION_SECRET` is required for authentication. Portfolio balance calls are
made on the server and always derive the owner address from the verified
session, never from a browser query or header.

## Verification

```bash
pnpm build
pnpm test
pnpm validate:portfolio-read
pnpm validate:execution
pnpm validate:xstocks
```

The portfolio validator makes structural, read-only mainnet RPC calls against a
well-known public address. The execution validator obtains a live Jupiter quote.
Neither command signs or submits a transaction.

The xStocks validator ingests the full current catalog, reports exclusions, then
sequentially inspects AAPLx, NVDAx and TSLAx using mint reads and GET quotes only.
Scaled quantities preserve raw u64 strings. The portfolio admits supported
xStocks only after its RPC/Scaled UI checks; unknown display multipliers remain
unvalued. Local decimal scale calculations are estimates, not guarantees of
Token-2022 binary-float equivalence. SELL amounts and limits use base token units,
not scaled display shares.

Wallet connection alone does not prove ownership. Signing in creates a
wallet-bound HttpOnly session; neither it nor MCP OAuth grants automatic
transaction authority. Owner delegation and per-agent execution policy are
separate controls.

## Application routes

- `/` — StockPilot landing; current versus planned capabilities explicitly labeled
- `/app` — authenticated Activity, Agents, and Wallet overview
- `/wallet` — verified wallet identity, SOL/USDC balances, and investment holdings
- `/markets?group=private` and `/markets?group=public` — Pre-IPO and Stocks directories
- `/markets/[symbol]` and `/markets/xstocks/[mint]` — issuer detail; manual controls only for supported products and eligible configured sessions
- `/clients` and `/clients/[id]` — OAuth connections, read/request policy, wallet delegation, and agent execution policy
- `/approvals` and `/activity` — consent requests and account-scoped audit history
- `/api/markets` — public GET discovery with query/provider/marketType/group/limit/cursor filters
- `/api/assets?q=...` — validated asset list/search API
- `/api/assets/[symbol]` — validated exact-symbol asset API
- `/api/auth/*` — authentication, session, and logout APIs
- `/api/portfolio` — session-bound SOL, USDC, and supported issuer holdings
- `/api/mcp` — authenticated market/wallet reads and separately authorized agent actions

## Documentation

- [Current manual and agent wallet execution boundary](docs/AGENT_WALLET_EXECUTION.md)
- [Tokenized market discovery closeout (25-point report)](docs/TOKENIZED_MARKET_DISCOVERY_REPORT.md)
- [xStocks product and token evidence](docs/XSTOCKS_PRODUCT_EVIDENCE.md)
- [Architecture correction closeout](docs/ARCHITECTURE_CORRECTION_REPORT.md)
- [Product and agent control-plane architecture](docs/PRODUCT_ARCHITECTURE.md)
- [PayBox read-only product research](docs/PAYBOX_PRODUCT_RESEARCH.md)
- [Official xStocks validation and blockers](docs/XSTOCKS_VALIDATION.md)
- [UI verification](docs/UI-REDESIGN-QA.md)
- [Implementation status](docs/IMPLEMENTATION.md)
- [Phase 1 execution validation](docs/EXECUTION_VALIDATION.md)
- [Wallet authentication](docs/AUTHENTICATION.md)
- [Design foundation](docs/DESIGN.md)

PreStocks provide economic exposure to private companies and do not necessarily represent direct ownership, shareholder rights, or voting rights. Investing involves risk.
