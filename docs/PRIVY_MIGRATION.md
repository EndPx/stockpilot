# Privy-only identity and wallet migration

Decision: Privy is the login and Solana wallet for StockPilot. Google is the
primary sign-in method. Phantom/Wallet Standard sign-in was removed from the
live app at the Privy cutover. Investment and agent execution remain disabled.

## Current implementation checkpoint (2026-09-23)

The repository has a guarded Privy mode (`NEXT_PUBLIC_AUTH_PROVIDER=privy`):
the two-panel `/sign-in` surface, Google/email Privy modal, automatic primary
Solana embedded wallet creation, server-side access-token verification, a
strict primary-wallet lookup, a short-lived StockPilot cookie and read-only
portfolio path. The old SIWS challenge/verify endpoints and legacy Jupiter
investment routes are disabled in Privy mode. The live deployment at
`stockpilot.endpx.cloud` now serves the signed-in read-only Overview, Credentials,
Pre-IPO and Stocks pages. A prior image and a protected runtime configuration
copy remain available for rollback.

Local verification: 210 tests and the production build pass. The
production dependency audit has no high or critical findings after pinning
vulnerable transitive `ws` 8.x releases to 8.21.3; three moderate findings
remain. The VPS image build, isolated-container smoke test, public HTTPS health,
sign-in rendering, disabled legacy auth and investment endpoints, unauthenticated
portfolio rejection, and security headers passed. Subsequent browser acceptance
with the user's Google session confirmed the server-verified primary Privy
Solana wallet, read-only portfolio, Credentials and Markets. This wallet was
unfunded at the last read. No transaction has been attempted.

The next manual-BUY implementation is not a flag flip. The legacy signing UI
uses Wallet Standard, while Privy exposes a Solana `useSignTransaction` method
that returns signed transaction bytes. Its route must bind the Privy-selected
wallet to the active server session and preserve user review and wallet approval.
The first code checkpoint now includes a Privy signer adapter and panel that reuse
the existing manual review flow. The client selects the one wallet matching the
server-verified primary wallet, requests a mainnet sign-only transaction through
Privy, and submits the returned wire bytes only through the existing execution
API. Unit tests cover wallet selection and malformed signing results. This code
is deliberately unreachable on the current production page because both Privy
investment endpoints remain disabled; it is not a mainnet acceptance result.
Before either investment endpoint can be enabled in Privy mode, add an
instruction-level validator for the prepared Jupiter transaction (including
resolved address lookup tables), durable submission/idempotency and ambiguous
confirmation reconciliation, and tests for rejection, mismatch, expiry,
concurrency and wallet changes. Until then, `INVESTMENTS_ENABLED=true` alone
still returns `INVESTMENTS_DISABLED` for both Privy routes.

Privy Dashboard now has Google login enabled, external-wallet login disabled,
and automatic wallet creation restricted to Solana. Its allowed origins are
`https://stockpilot.endpx.cloud`, `http://localhost:3000`, and
`http://localhost:3100` for
testing; OAuth return URLs are restricted to `/sign-in` on those three origins.
These settings were verified after a dashboard reload. The shared Google Cloud
OAuth project was deliberately left unchanged because it has other OAuth
clients, unrelated consent branding and Testing status. Privy's built-in Google
OAuth is used instead. `PRIVY_APP_SECRET` is absent from source and installed
only in the root-owned, mode-`0600` server runtime file. A missing secret makes
`/sign-in` unavailable. No existing Phantom funds move to the new wallet.

Before expanding beyond the current limited production beta, remove the two
localhost origins and redirect URLs and review Privy HttpOnly-cookie and MFA
options against the implemented session flow. The user accepted leaving the
Privy app in development mode with its 150-user limit for now.

## Account and wallet boundaries

1. Privy authenticates the person. The backend verifies a Privy access token
   against the configured application, then derives a stable Privy user ID.
   Neither an email address nor a client-supplied wallet address is authority.
2. One user-owned Privy embedded **Solana** wallet is selected server-side from
   the verified user's linked wallets. Creating another wallet must never
   silently change the portfolio/execution wallet.
3. The existing portfolio reader uses only this verified Solana address. Logout,
   account changes and token expiry revoke access to private reads and actions.
4. A new Privy wallet has a new address. Existing Phantom balances and positions
   stay in Phantom until the user independently transfers them. StockPilot must
   not auto-sweep, import a private key, or imply that Google login moved funds.
5. Wallet creation follows explicit user login/consent. Agent delegation is a
   separate, explicit grant, never a side effect of Google login or wallet
   creation. Privy owner, signer and export/recovery settings need review before
   a funded wallet is used.

## Two transaction paths, one validation boundary

The dashboard and an agent submit the same immutable BUY/SELL intent. Server
code resolves the canonical asset and funding/output mints, verifies current
wallet holdings and provider eligibility, constrains amount/slippage/fees and
expiry, inspects every instruction and resolved address of the prepared Solana
transaction, and records the exact authorized transaction. A chart, ticker,
email address or LLM response is never transaction authority.

- Manual dashboard path: the authenticated user reviews and signs through the
  Privy embedded wallet. Do not route it through the agent signer.
- Autonomous path: the agent supplies only an intent. A server-held Privy
  authorization key may sign only after a current user grant, wallet binding,
  exact transaction validation, atomic budget reservation, idempotency check and
  revocation recheck. The agent never receives the key, Privy app secret, raw
  signing endpoint or arbitrary transaction API.
- A submitted transaction remains unresolved until authoritative chain
  reconciliation. Timeouts must not automatically create a fresh quote,
  transaction or signature. Portfolio refresh follows confirmed results.

The grant must be revocable and time-limited, with explicit BUY/SELL operation,
canonical asset allowlist, per-trade and aggregate USDC limits, slippage cap and
frequency cap. Withdrawal, arbitrary transfer, program invocation, key export and
unapproved assets are not agent operations. Store audit events and budget state
durably; the present Redis authentication store is not an investment ledger.

Privy Solana policies are a second enforcement layer, not StockPilot's only
validator. Privy's published stateful aggregation methods currently cover EVM,
not Solana, and Solana address-based policy checks cannot resolve addresses held
in Address Lookup Tables. For a route that cannot be independently validated,
fail closed rather than dropping the address restriction.

## Rollout gates

1. Configure a dedicated Privy application for the exact production origin and
   Google login. Put the public app ID in client configuration and secrets only
   in protected server configuration; never commit or paste secrets in chat.
2. Implement Privy-only sign-in, verified session, wallet creation/selection,
   logout and portfolio read in an isolated release. The live cutover was made
   at the user's request with rollback available; finish real Google login and
   new-wallet browser acceptance before funding or enabling execution.
3. Implement and test manual BUY and SELL with the embedded wallet and the
   complete transaction validator/reconciliation. Keep execution disabled until
   small mainnet acceptance on the new wallet.
4. Add a durable grant, budget and audit store; protect the signer key outside
   the application repository; configure restrictive Privy Solana policies.
   Test revocation, concurrent requests, duplicate submissions, malformed
   transactions, ALT resolution and provider failures before enabling agents.
5. Enable autonomous execution only for an explicitly opted-in, small-limit
   account after an independent security review. Keep an operator kill switch.

No step above authorizes moving the user's funds or executing a transaction.

Sources checked 2026-09-23:

- [Privy automatic Solana wallet creation](https://docs.privy.io/basics/react/advanced/automatic-wallet-creation)
- [Privy signer provisioning](https://docs.privy.io/wallets/using-wallets/signers/delegate-wallet)
- [Privy Solana policy examples and ALT limitation](https://docs.privy.io/controls/policies/example-policies/solana)
- [Privy stateful policy supported methods](https://docs.privy.io/controls/policies/stateful-policies)
