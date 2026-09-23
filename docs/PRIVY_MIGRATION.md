# Privy-only identity and wallet migration

Decision: Privy is the target login and Solana wallet for StockPilot. Google is
the primary sign-in method. Phantom/Wallet Standard sign-in is removed at the
production cutover, not silently replaced on the live site before Privy works.
This document describes the target; the current deployment still uses SIWS and
has investment and agent execution disabled.

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
   logout and portfolio read in an isolated release. Preserve the current live
   deployment until Google login and the new wallet are accepted in a browser.
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
