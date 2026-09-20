# StockPilot

StockPilot is an agent-native investing experience built specifically for PreStocks on Solana. It makes PreStocks a native investing capability for the AI agents users already use.

## Current status

- Phase 1: live PreStocks mint discovery and USDC-to-PreStocks Jupiter quote validation complete.
- Phase 2: shared asset architecture, Next.js application, live markets, and asset detail pages complete.
- Phase 3: Wallet Standard connection, reconnect state, connected identity, and disconnect complete. Wallet authentication remains a later phase.

The web application reads live provider data. Prices and the available asset registry can change between requests.

## Product boundary

The investable universe is limited to official assets returned by PreStocks. StockPilot does not create wrapped or synthetic versions of those assets and does not expose arbitrary SPL-token trading.

The first future investment path is intentionally narrow:

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

Users will not need to already own a PreStocks token. A later phase may also support SOL as a funding asset, but every investment output will remain an official PreStocks asset.

Jupiter is infrastructure behind an investment-specific experience; StockPilot is not a generic DEX or generic Jupiter interface. Tessera, Pyth, Meteora DBC, Clawpump, non-PreStocks pre-IPO tokens, and custom StockPilot-wrapped assets are outside the product scope. Meteora may still appear as a venue chosen inside a Jupiter route.

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

Use **Connect Wallet** to choose an installed Wallet Standard compatible Solana wallet. Compatible wallets such as Phantom, Solflare, and Backpack are discovered by capability rather than hardcoded by vendor.

No environment variables are required for the default live PreStocks endpoint. `PRESTOCKS_API_URL` can override it for local testing.
Phase 3 makes no RPC request, so it does not require or expose a browser RPC URL or credential.

## Verification

```bash
pnpm build
pnpm test
pnpm validate:execution
```

The execution validator makes live mainnet-facing requests and obtains a quote; it does not sign or submit a transaction.

Wallet connection only makes a browser wallet available to the frontend. It is not StockPilot authentication and does not create a user session or prove wallet ownership to the backend.

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
