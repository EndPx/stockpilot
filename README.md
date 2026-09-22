# StockPilot

StockPilot is building an agent-native tokenized-stock investing experience on Solana. Official PreStocks power private markets; the official xStocks Solana catalog powers public-market discovery. Human wallet authorization remains the execution boundary.

## Current status

- Phase 1: live PreStocks mint discovery and USDC-to-PreStocks Jupiter quote validation complete.
- Phase 2: shared asset architecture, Next.js application, live markets, and asset detail pages complete.
- Phase 3: Wallet Standard connection, reconnect state, connected identity, and disconnect complete.
- Phase 4: Sign In With Solana authentication and wallet-bound server sessions complete.
- Phase 5: authenticated, read-only USDC, SOL, and official PreStocks portfolio discovery complete.
- Human BUY implementation exists; real mainnet investment acceptance remains outstanding.
- Public discovery: paginated canonical xStocks ingestion, evidence-backed classification, bounded Markets search and read-only public detail are enabled. Known private-exposure products are excluded (currently VCXx). Agent features and xStocks investment execution are **not enabled**.
- Lazy execution eligibility is read-only and fail-closed, with expiring technical results separate from discovery. No production xStocks product-review clearance is configured.

The web application reads live provider data. Prices and the available asset registry can change between requests.

## Product boundary

Today the operational investment universe is official PreStocks only. Discovery also supports `PUBLIC_EQUITY`, `ETF` and unclassified `PUBLIC_MARKET_PRODUCT` from xStocks, never arbitrary SPL tokens. **All pre-IPO/private-company exposure must remain exclusively PreStocks.** Canonicality, classification and execution eligibility are separate; a listed fund does not override that invariant.

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

Restart `pnpm dev` after pulling provider/domain changes: per-process provider
singletons survive hot reload and can retain old normalizer implementations.

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
pnpm validate:xstocks
```

The portfolio validator makes structural, read-only mainnet RPC calls against a
well-known public address. The execution validator obtains a live Jupiter quote.
Neither command signs or submits a transaction.

The xStocks validator ingests the full current catalog, reports exclusions, then
sequentially inspects AAPLx, NVDAx and TSLAx using mint reads and GET quotes only.
Scaled quantities preserve raw u64 strings; local decimal scale calculations are
explicit estimates, not guarantees of Token-2022 binary-float equivalence. xStocks
portfolio admission is postponed until same-context RPC display and price units
are validated. The existing PreStocks portfolio path is unchanged.

Wallet connection alone does not prove ownership. Signing in creates a
wallet-bound HttpOnly session; it does not grant transaction authority.

## Application routes

- `/` — StockPilot landing; current versus planned capabilities explicitly labeled
- `/app` — authenticated read-only portfolio overview
- `/markets` — bounded, searchable public/private directory; All / Private / Public filters
- `/markets/[symbol]` — live asset detail and verified Solana mint
- `/markets/xstocks/[mint]` — canonical public product detail, discovery only
- `/api/markets` — public GET discovery with query/provider/marketType/group/limit/cursor filters
- `/api/assets?q=...` — validated asset list/search API
- `/api/assets/[symbol]` — validated exact-symbol asset API
- `/api/auth/*` — SIWS challenge, verification, session, and logout APIs
- `/api/portfolio` — session-bound USDC, SOL, and official PreStocks balances

## Documentation

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
