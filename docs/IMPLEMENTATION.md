# Implementation Checklist

Last verified: 2026-09-21

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

## Phase 3 — Solana wallet connection

- [x] Discover compatible mainnet wallets through Wallet Standard.
- [x] Connect from the navigation or minimal home page without gating Markets.
- [x] Show a shortened address in controls and the full address, wallet name, and network in the wallet dialog.
- [x] Persist the selected wallet account and attempt silent reconnect after reload.
- [x] Disconnect without clearing unrelated application data.
- [x] Handle pending, reconnecting, connecting, connected, disconnecting, no-wallet, and recoverable error states.
- [x] Preserve usable layouts at 375 px mobile, 768 px tablet, and desktop widths.

Wallet connection means frontend access to a Wallet Standard wallet. It is not authentication, does not prove ownership to the StockPilot backend, and does not create a user session.

### Tooling choice

The web application uses exact versions of the maintained Solana frontend stack:

- `@solana/kit` 8.3.0 for the composable client.
- `@solana/kit-plugin-wallet` 0.20.0 for Wallet Standard discovery, connection state, persistence, and reconnect.
- `@solana/react` 8.3.0 for the client provider and reactive hooks.

The wallet plugin is installed with `walletWithoutSigner`. This intentionally adds wallet state without assigning a client payer or identity. No legacy `@solana/web3.js` v1 or wallet-adapter packages were added. No wallet vendor is hardcoded; Phantom, Solflare, Backpack, and other compatible wallets appear when their installed provider advertises Solana mainnet and `standard:connect`.

Phase 3 performs no RPC calls, balance reads, message signing, transaction signing, or transaction submission. Consequently there is no `NEXT_PUBLIC_SOLANA_RPC_URL` and no paid or private RPC credential to configure. The mainnet chain identifier is centralized in `apps/web/lib/solana/config.ts`.

### Wallet architecture

```text
apps/web/
  providers/solana-provider.tsx         stable application-wide Kit client
  lib/solana/config.ts                  mainnet chain and persistence key
  lib/solana/address.ts                 reusable address shortening
  components/wallet/wallet-button.tsx   Wallet Standard UI and lifecycle actions
  tests/wallet.test.ts                  extension-independent UI state coverage
```

The provider wraps the application shell, so public Markets and Asset Detail pages retain their server-rendered data path while wallet state is available to client controls. Server and first-client wallet rendering share a stable pending state to prevent hydration mismatches.

### Final Phase 3 verification

On 2026-09-21:

- `pnpm build` passed with every application and API route compiled.
- `pnpm test` passed all 14 existing service tests and 5 wallet UI tests.
- Production browser checks had no console warnings or errors.
- Wallet discovery, connection, full and shortened address display, connected Markets access, disconnect, reconnect, and reload recovery were checked with an isolated Wallet Standard mock; no real wallet keys or transactions were used.
- The no-installed-wallet state, Escape dismissal with focus restoration, and disconnected Markets access were checked.
- Live `/markets` returned 8 official PreStocks assets and live `/markets/SPACEX` metadata loaded while disconnected; Markets also retained all 8 assets while connected.
- Desktop, 768 px tablet, and 375 px mobile layouts had no document-level horizontal overflow.

The live Phase 1 execution regression is recorded again at final handoff because quote output and routes are time-sensitive.

## Phase 4 — wallet authentication and proof of ownership

- [x] Issue a fresh five-minute, server-controlled SIWS challenge with a random nonce.
- [x] Verify the signed wallet address, signature, domain, URI, nonce, statement, chain, issue time, expiry, and request identifier.
- [x] Prefer Wallet Standard `solana:signIn` and support canonical SIWS `solana:signMessage` as a compatibility fallback.
- [x] Create a wallet-bound, HMAC-signed, 24-hour session in an HttpOnly cookie.
- [x] Restore authenticated state after reload only when the session wallet matches the connected wallet.
- [x] Keep sign out separate from wallet disconnect, while ensuring disconnect also clears authentication.
- [x] Clear a previous session when the connected wallet account changes.
- [x] Keep Markets, Asset Detail, and asset APIs public.

The Solana client still uses `walletWithoutSigner`. Authentication invokes only
the connected wallet's Wallet Standard sign-in or message-signing feature; it
does not install a global transaction signer or call a transaction API.

Challenge and session state are stateless HMAC-SHA-256 tokens authenticated by
`SESSION_SECRET`. The authoritative challenge is held in a short-lived HttpOnly
cookie and consumed on every verification attempt. This avoids a process-local
nonce registry, so application restarts and multiple instances with the same
secret can verify the same state. Mutation routes require the configured
`APP_URL` origin. See [AUTHENTICATION.md](AUTHENTICATION.md) for the protocol and
cookie details.

### Final Phase 4 verification

On 2026-09-21:

- `pnpm build` compiled all public and authentication routes.
- `pnpm test` passed 14 core/service tests and 19 web/authentication tests.
- Direct route tests used generated Ed25519 keypairs to cover valid proofs,
  invalid signatures, tampered statements, wrong nonces, expired challenges,
  replay, wrong domain, wrong wallet, cross-origin mutation, session restoration,
  logout, and invalid session cookies.
- Browser acceptance covered Wallet Standard SIWS and the `signMessage` fallback,
  reload restoration, sign out, disconnect, account switching, public Markets and
  Asset Detail, keyboard dismissal, and 375 px, 768 px, and 1280 px layouts with
  no browser console warnings or errors.
- A real Phantom, Solflare, or Backpack extension was not available in the
  isolated browser environment. Real-wallet acceptance remains a repository-owner
  check and is not represented as passed.

## Future phases

- [x] Phase 4: wallet authentication and ownership verification.
- [ ] Phase 5: portfolio discovery.
- [ ] Phase 6: USDC to official PreStocks investment execution.
- [ ] Phase 7: pending action and approval system.
- [ ] Phase 8: agent credentials and policy engine.
- [ ] Phase 9: StockPilot MCP.
- [ ] Phase 10: bounded recurring investment.

Trade execution, database storage, MCP tools, agents, and automations remain out of scope until explicitly scheduled.
