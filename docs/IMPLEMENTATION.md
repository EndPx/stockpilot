# Implementation Checklist

Last verified: 2026-09-20

## Product scope

StockPilot is an agent-native investing experience for official PreStocks assets on Solana.

```text
Funding asset (USDC first; SOL may follow)
    ↓
StockPilot investment intent using a PreStocks symbol
    ↓
verified official mint from the PreStocks Asset Service
    ↓
Jupiter execution infrastructure
    ↓
Solana wallet approval
```

The user does not need to already own a PreStocks token. Jupiter remains internal execution infrastructure rather than a generic swap surface, and an agent must never select an arbitrary output mint. Arbitrary SPL-token trading, non-PreStocks pre-IPO assets, Tessera, Pyth, Meteora DBC, Clawpump, and StockPilot-created wrappers are out of scope. A Jupiter route may still use Meteora as an execution venue.

## Phase 1 — execution validation

- [x] Fetch and normalize live PreStocks assets.
- [x] Verify returned mint addresses are valid Solana public keys and mainnet token mints.
- [x] Record the canonical Solana mainnet USDC mint.
- [x] Obtain a live Jupiter quote for USDC to an allowlisted PreStocks mint.
- [x] Document the observed result and limitations.

See [EXECUTION_VALIDATION.md](EXECUTION_VALIDATION.md) for the original Phase 1 evidence.

## Phase 2 — web application foundation

- [x] Add a minimal Next.js App Router application with TypeScript and Tailwind CSS.
- [x] Move the PreStocks adapter to one shared integration package.
- [x] Define a canonical `Asset` model without exposing the raw provider response to the UI.
- [x] Add an `AssetService` with case-insensitive exact symbol lookup, exact mint lookup, and case-insensitive search across symbol, name, and description.
- [x] Cache live data for 45 seconds with a bounded five-minute stale fallback.
- [x] Add validated asset list and detail API routes with distinct 400, 404, and provider-failure responses.
- [x] Render a searchable live Markets table with distinct Token Price and Mark Price labels.
- [x] Render live Asset Detail pages with valuation data, description, provider attribution, Solana mint, copy control, external links, and risk disclaimer.
- [x] Add loading skeletons, provider-unavailable recovery, no-results, empty-registry, malformed-response, invalid-symbol, and not-found states.
- [x] Add focused unit tests for normalization, caching, lookups, search, input validation, and number formatting.
- [x] Preserve the Phase 1 execution validation through the shared PreStocks adapter.

### Architecture

```text
apps/web/
  app/                    Next.js pages and API route handlers
  components/             small reusable UI components
  lib/                    server facade, validation, errors, and formatting

packages/core/
  src/assets.ts           AssetService, cache, search, and deterministic lookups

packages/integrations/
  src/prestocks.ts        sole PreStocks fetch and normalization implementation

src/
  jupiter.ts              Phase 1 Jupiter quote integration
  solana.ts               Phase 1 Solana mint checks
  validate-execution.ts   live regression validator
```

No separate schemas package was introduced: the canonical model currently has a single owner in the integration package and is re-exported by the core package. This keeps Phase 2 small while leaving room to extract schemas when multiple independent consumers require them.

### Final Phase 2 verification

On 2026-09-20:

- `pnpm build` passed with all application and API routes compiled.
- `pnpm test` passed 14 of 14 tests.
- `pnpm validate:execution` loaded 8 assets and passed a live 1 USDC to SPACEX Jupiter quote through Meteora DLMM.
- The live registry returned ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, and SPACEX.
- Desktop, 768 px tablet, and 375 px mobile layouts were checked in a browser.
- Search, no-results, detail navigation, mint matching, not-found, empty-registry, delayed loading, provider failure/retry, and malformed provider response states were checked.

Live prices, quote output, route, and asset availability are observations rather than fixed application data.

## Phase 3 — wallet connection in progress

- [ ] Solana wallet connection.
- [ ] Connected wallet UI state.
- [ ] Wallet disconnect and reconnect.

Wallet connection means frontend access to a Wallet Standard wallet. It is not authentication, does not prove ownership to the StockPilot backend, and does not create a user session.

## Future phases

- [ ] Phase 4: wallet authentication and ownership verification.
- [ ] Phase 5: portfolio discovery.
- [ ] Phase 6: USDC to official PreStocks investment execution.
- [ ] Phase 7: pending action and approval system.
- [ ] Phase 8: agent credentials and policy engine.
- [ ] Phase 9: StockPilot MCP.
- [ ] Phase 10: bounded recurring investment.

Trade execution, database storage, MCP tools, agents, and automations remain out of scope until explicitly scheduled.
