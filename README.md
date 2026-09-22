# StockPilot

StockPilot is building an agent-native tokenized-stock investing experience on Solana. Official PreStocks power private markets; verified xStocks are the planned public-equity/ETF provider. Human wallet authorization remains the execution boundary.

## Current status

- Phase 1: live PreStocks mint discovery and USDC-to-PreStocks Jupiter quote validation complete.
- Phase 2: shared asset architecture, Next.js application, live markets, and asset detail pages complete.
- Phase 3: Wallet Standard connection, reconnect state, connected identity, and disconnect complete.
- Phase 4: Sign In With Solana authentication and wallet-bound server sessions complete.
- Phase 5: authenticated, read-only USDC, SOL, and official PreStocks portfolio discovery complete.
- Human BUY implementation exists; real mainnet investment acceptance remains outstanding.
- Architecture correction: client/credential/grant/approval boundaries documented, provider-aware registry foundation tested. Agent features and production xStocks integration are **not enabled**. Execution work is frozen pending the revised asset-universe gates.

The web application reads live provider data. Prices and the available asset registry can change between requests.

## Product boundary

Today the operational investment universe is official PreStocks only. The domain supports `PRE_IPO + prestocks` and `PUBLIC_EQUITY + xstocks`, never arbitrary SPL tokens. **All pre-IPO assets must remain exclusively PreStocks.** Public equities are a separate category, not a competing pre-IPO integration.

The current human-authorized investment path remains intentionally narrow:

```text
User investment intent
    ↓
USDC funding
    ↓
StockPilot resolves an official PreStocks asset and mint
    ↓
Jupiter supplies execution infrastructure
    ↓
Solana wallet approval
```

Users do not need to already own a PreStocks token. USDC remains the only investment funding asset. Public-stock execution requires a separately validated canonical registry, eligibility controls and scaled-amount handling before activation.

Jupiter is infrastructure behind an investment-specific experience; StockPilot is not a generic DEX or Jupiter interface. Non-PreStocks pre-IPO tokens and custom StockPilot-wrapped assets are outside the product scope. Meteora may appear as a venue chosen inside a Jupiter route.

## Architecture

```text
PreStocks API
    ↓
packages/integrations  — fetches and normalizes the remote registry
    ↓
packages/core          — canonical assets, bounded cache, and portfolio domain service
    ↓
apps/web               — Next.js UI, authenticated APIs, and Solana balance adapter

src                    — Phase 1 Solana and Jupiter validation path
```

The web application and the Phase 1 validation script use the same PreStocks integration. The server cache is fresh for 45 seconds and may serve a successful response for up to five minutes if a later provider refresh fails; stale responses are identified in response metadata and the UI.

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

Open `http://localhost:3000`, then use **Open the app** or visit `/markets`
directly. Markets remain public. Connect and sign in with a wallet before
opening `/app` to load its private portfolio.

Use **Connect Wallet** to choose an installed Wallet Standard compatible Solana wallet. Compatible wallets such as Phantom, Solflare, and Backpack are discovered by capability rather than hardcoded by vendor.

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
```

The portfolio validator makes structural, read-only mainnet RPC calls against a
well-known public address. The execution validator obtains a live Jupiter quote.
Neither command signs or submits a transaction.

Wallet connection alone does not prove ownership. Signing in creates a
wallet-bound HttpOnly session; it does not grant transaction authority.

## Application routes

- `/` — StockPilot landing; current versus planned capabilities explicitly labeled
- `/app` — authenticated read-only portfolio overview
- `/markets` — searchable live PreStocks registry
- `/markets/[symbol]` — live asset detail and verified Solana mint
- `/api/assets?q=...` — validated asset list/search API
- `/api/assets/[symbol]` — validated exact-symbol asset API
- `/api/auth/*` — SIWS challenge, verification, session, and logout APIs
- `/api/portfolio` — session-bound USDC, SOL, and official PreStocks balances

## Documentation

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
