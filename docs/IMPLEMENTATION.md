# Implementation Checklist

Last verified: 2026-09-22

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
- [x] Phase 5: read-only portfolio discovery and available-to-invest balance.
- [x] Phase 6: USDC to official PreStocks investment execution.
- [ ] Phase 7: pending action and approval system.
- [ ] Phase 8: agent credentials and policy engine.
- [ ] Phase 9: StockPilot MCP.
- [ ] Phase 10: bounded recurring investment.

Database storage, MCP tools, agents, sell execution, and automations remain out of scope until explicitly scheduled.

## Phase 6 — first USDC investment

Phase 6 adds one explicit BUY path from canonical Solana mainnet USDC to an
official PreStocks mint. The asset page supplies only an official symbol and the
user's USDC amount. The server derives the authenticated wallet from the Phase 4
session, resolves the current official mint from `AssetService`, verifies the
fresh canonical USDC balance, and requests a Jupiter Swap API V2 Meta-Aggregator
order without custom routing, slippage, payer, referral, or fee parameters.

```text
authenticated asset page
    ↓ { symbol, amountUsd }
POST /api/investments/prepare
    ├─ session wallet + same-origin enforcement
    ├─ AssetService → official output mint
    ├─ PortfolioService → authoritative USDC balance
    ├─ Solana RPC → output decimals
    └─ Jupiter /swap/v2/order
         ↓ transaction + requestId + short-lived bound authorization
review dialog
    ↓ Wallet Standard solana:signTransaction
POST /api/investments/execute
    ├─ session/token/wallet/expiry checks
    ├─ exact transaction-message fingerprint check
    ├─ authenticated wallet signature check
    └─ Jupiter /swap/v2/execute
         ↓ actual amounts + signature
fresh GET /api/portfolio
```

The investment authorization is stateless and HMAC-SHA-256 authenticated with
`SESSION_SECRET`. It binds the session wallet, symbol, canonical input and
official output mints, raw input amount, Jupiter request identifier, transaction
message fingerprint, order validity fields, output decimals, and a short expiry.
Signing may populate more than one signature slot, as required by JupiterZ, but
must not alter the serialized versioned transaction message. The authenticated
wallet's signature slot must be present and signed before execution.

The client uses the connected account's Wallet Standard
`solana:signTransaction` capability locally. It never installs a global signer,
never signs automatically, never retries signing or submission automatically,
and never reports success before Jupiter execution succeeds. Success quantities
come from Jupiter's `totalInputAmount` and `totalOutputAmount`; the subsequent
portfolio refresh continues to read balances from Solana rather than deriving
holdings from the transaction response.

### Phase 6 delivery checklist

- [x] Parse positive USDC amounts exactly with at most six fractional digits.
- [x] Add a server-only Jupiter Swap API V2 order/execute adapter.
- [x] Resolve official output mints and canonical USDC only on the server.
- [x] Enforce fresh session-wallet USDC balance before order preparation.
- [x] Bind a short-lived investment authorization to the transaction message.
- [x] Reject changed messages, missing wallet signatures, wrong sessions, and expired orders.
- [x] Add authenticated, same-origin prepare and execute routes with strict bodies.
- [x] Add an asset-page amount, review, wallet approval, submission, and success flow.
- [x] Refresh the blockchain-backed portfolio after successful execution.
- [x] Add deterministic security, route, adapter, domain, and client-orchestration tests.
- [x] Add a safe order-only validator that never signs or executes.
- [x] Complete production build, regression tests, browser acceptance, and real-wallet status.

### Final Phase 6 verification

On 2026-09-22:

- `pnpm test` passed 91 deterministic core, API, security, wallet-orchestration,
  and portfolio tests.
- `pnpm build` completed the production TypeScript and Next.js build, including
  both investment routes.
- `pnpm validate:execution` read the live registry, verified the official SPACEX
  mint, and found a non-executed 1 USDC route through Meteora DLMM.
- `pnpm validate:portfolio-read` decoded a public mainnet wallet's native, legacy
  SPL, and Token-2022 accounts without a key or transaction.
- `pnpm validate:investment-order` is intentionally order-only. This environment
  has no `JUPITER_API_KEY`, so it made no request and printed its explicit safe
  blocked state; it can never sign or call Jupiter execute.
- Browser acceptance confirmed public asset rendering, the disconnected investment
  state, responsive 375 px / 768 px / 1280 px layouts without horizontal overflow,
  and keyboard dismissal of the wallet dialog with focus restoration. The sole
  console warning came from the development-only React Scan tooling reporting an
  outdated `react-grab` helper, not from application code.

`REAL MAINNET INVESTMENT ACCEPTANCE: BLOCKED BY ENVIRONMENT`

No compatible wallet extension, authenticated wallet session, funded mainnet
wallet, or server-side `JUPITER_API_KEY` was available here. No wallet signature
or on-chain transaction was attempted.

### Manual real-wallet acceptance

1. Set the exact deployment origin as `APP_URL`, a strong `SESSION_SECRET`, and
   the server-only `JUPITER_API_KEY`; configure `SOLANA_RPC_URL` if needed.
2. Use a compatible wallet with a small canonical USDC balance and enough SOL for
   network fees, then connect and complete StockPilot sign-in.
3. Open an official asset page, enter a small USDC amount, and inspect every
   value in the review dialog before choosing **Approve in Wallet**.
4. Approve the transaction only in the wallet, wait for the explicit success
   state, compare actual quantities with the wallet/Solscan, and verify the
   refreshed portfolio.

Phase 6 deliberately contains no sell flow, database persistence, agent,
automation, MCP, or custom Jupiter fee/routing parameters. The authorization is
short-lived and stateless; durable idempotency/replay records belong to a later
explicit persistence phase.

## Phase 5 — read-only portfolio discovery

Phase 5 adds a private read model without changing the Phase 4 authentication
boundary. `GET /api/portfolio` validates the HttpOnly session and obtains the
wallet address exclusively from its verified payload. Query parameters, headers,
and request bodies cannot select or override the wallet being read.

```text
verified Phase 4 session
    ↓ walletAddress
PortfolioService
    ├─ AssetService → official PreStocks mint allowlist and token prices
    └─ SolanaReadAdapter
         ├─ native SOL balance
         ├─ legacy SPL Token owner accounts
         └─ Token-2022 owner accounts
```

The adapter normalizes RPC data into raw string amounts, authoritative account
decimals, display amounts, and a token-program label. The domain service merges
accounts by mint with bigint arithmetic, extracts canonical mainnet USDC as
Available to Invest, intersects remaining balances with the current official
PreStocks mint set, and values those positions with PreStocks `tokenPrice` only.
Missing prices stay `null`; provider and RPC failures remain errors rather than
being converted into an empty portfolio.

Wallet balances are read fresh and are not cached for minutes. Existing bounded
AssetService metadata caching remains in place. The browser requests the private
portfolio only after authentication and may refresh it on explicit retry. Native
SOL is informational Network Balance and is neither converted to USD nor included
in Available to Invest. This phase contains no Jupiter calls, transaction signing,
database storage, P&L, or generic wallet-portfolio behavior.

### Delivered

- [x] Derive the portfolio owner exclusively from the verified Phase 4 session.
- [x] Read canonical mainnet USDC as Available to Invest at 1 USDC = $1.
- [x] Read native SOL separately as informational Network Balance.
- [x] Query both the legacy SPL Token Program and Token-2022 by owner.
- [x] Decode raw integer amounts with RPC-provided decimals and bigint-safe arithmetic.
- [x] Intersect wallet mints with the current official PreStocks allowlist.
- [x] Exclude unrelated assets and omit zero-balance PreStocks positions.
- [x] Estimate positions from PreStocks `tokenPrice` without Jupiter or an oracle.
- [x] Preserve missing prices as `null` and failures as explicit unavailable states.
- [x] Add authenticated `/api/portfolio` and an auth-aware `/app` overview.
- [x] Keep Markets and its APIs public.
- [x] Cover funded-empty, unfunded-empty, loading, expired-session, RPC, and provider states.

### Architecture

```text
packages/core/src/portfolio.ts          portfolio model and aggregation service
packages/core/src/solana.ts             shared canonical mainnet constants
apps/web/lib/solana/read-adapter.ts     server-only Solana RPC normalization
apps/web/lib/portfolio.ts               production service composition
apps/web/app/api/portfolio/route.ts     session-bound private API
apps/web/components/portfolio-overview.tsx
                                        auth-aware read-only overview UI
```

### Final Phase 5 verification

On 2026-09-21:

- `pnpm test` passed 58 of 58 deterministic core, authentication, wallet,
  adapter, API, and portfolio UI tests.
- `pnpm build` compiled the application and all API routes.
- `pnpm validate:portfolio-read` decoded native, legacy SPL, and Token-2022 RPC
  responses from a well-known public address without a private key or transaction.
- `pnpm validate:execution` loaded 8 official assets and preserved the live
  1 USDC to SPACEX route through Meteora DLMM.
- Browser acceptance covered authenticated portfolio fixtures, funded and empty
  presentation, navigation, keyboard focus, public Markets, and 375 px, 768 px,
  and 1280 px layouts without horizontal overflow or console warnings/errors.
- React Doctor reported no findings in the changed Phase 5 portfolio component
  after the final hardening pass.
- No real browser wallet extension was available in the isolated environment.
  `REAL WALLET PORTFOLIO ACCEPTANCE: BLOCKED BY ENVIRONMENT`.

### Manual real-wallet acceptance

1. Set `APP_URL` to the exact local or deployment origin.
2. Set a secret `SESSION_SECRET` with at least 32 bytes of entropy.
3. Set the server-only `SOLANA_RPC_URL` when the default public RPC is unsuitable.
4. Run `pnpm dev` and install/open Phantom, Solflare, Backpack, or another compatible wallet.
5. Connect the real wallet, sign in, and open `/app`.
6. Compare Available to Invest with the wallet's canonical mainnet USDC balance.
7. Compare Network Balance with its native SOL balance.
8. If it owns a PreStocks token, compare the displayed quantity with a Solana explorer or wallet.
9. Confirm unrelated tokens do not appear under Investments.
10. Reload `/app` and confirm the authenticated portfolio loads again.

Phase 5 remains deliberately read-only. The next smallest task is Phase 6:
USDC to an official PreStocks asset through the existing website investment
flow, with explicit wallet approval. It is not implemented here.
