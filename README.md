# StockPilot

StockPilot is a minimal web foundation for browsing tokenized pre-IPO assets from PreStocks. Its Solana execution path is independently validated against Jupiter, while trade execution remains intentionally outside the Phase 2 web application.

## Current status

- Phase 1: live PreStocks mint discovery and USDC-to-PreStocks Jupiter quote validation complete.
- Phase 2: shared asset architecture, Next.js application, live markets, and asset detail pages complete.
- Phase 3: wallet connection and wallet authentication not started.

The web application reads live provider data. Prices and the available asset registry can change between requests.

## Architecture

```text
PreStocks API
    ↓
packages/integrations  — fetches and normalizes the remote registry
    ↓
packages/core          — canonical Asset model, search, lookup, and bounded cache
    ↓
apps/web               — Next.js routes, API endpoints, Markets UI, Asset Detail UI

src                    — Phase 1 Solana and Jupiter validation path
```

The web application and the Phase 1 validation script use the same PreStocks integration. The server cache is fresh for 45 seconds and may serve a successful response for up to five minutes if a later provider refresh fails; stale responses are identified in response metadata and the UI.

## Requirements

- Node.js 20.9 or newer
- pnpm 10

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, then use **Explore Markets** or visit `/markets` directly.

No environment variables are required for the default live PreStocks endpoint. `PRESTOCKS_API_URL` can override it for local testing.

## Verification

```bash
pnpm build
pnpm test
pnpm validate:execution
```

The execution validator makes live mainnet-facing requests and obtains a quote; it does not sign or submit a transaction.

## Application routes

- `/` — minimal StockPilot introduction
- `/markets` — searchable live PreStocks registry
- `/markets/[symbol]` — live asset detail and verified Solana mint
- `/api/assets?q=...` — validated asset list/search API
- `/api/assets/[symbol]` — validated exact-symbol asset API

## Documentation

- [Implementation status](docs/IMPLEMENTATION.md)
- [Phase 1 execution validation](docs/EXECUTION_VALIDATION.md)
- [Design foundation](docs/DESIGN.md)

PreStocks provide economic exposure to private companies and do not necessarily represent direct ownership, shareholder rights, or voting rights. Investing involves risk.
