# Manual BUY release boundary

Decision (2026-09-25): Pre-IPO (official PreStocks) and Stocks (official
xStocks) must become executable in the **same** release. A foundation for one
market may be implemented or tested first, but neither market is to be exposed
as a live BUY flow on its own. Agent-initiated autonomous trading is a separate
authorization and release boundary.

## Current status

- Production remains read-only: the deployed health endpoint reports
  `investmentsEnabled: false` and `agentExecutionEnabled: false`. The Docker
  configuration also sets `INVESTMENTS_ENABLED=false`. Local manual routes now
  require Privy owner identity when the operator flag is enabled; this change
  has not been deployed as an enabled transaction release.
- PreStocks has a canonical USDC-to-issuer-mint order preparation service.
  xStocks now has a separate fail-closed order preparation service that requires
  fresh catalog identity, product and investor eligibility review, token
  compatibility, an executable route, canonical USDC balance, and a bounded
  order. The current xStocks catalog normalizer marks products
  `REVIEW_REQUIRED`; discovery and a quote are **not** trading permission.
- The local BUY preparer calls an instruction-effect verifier and puts the
  proven minimum token output and native-SOL debit cap into the short-lived
  signed authorization and owner review. The current verifier accepts only a
  narrowly decoded Jupiter V6 exact-in route; unsupported routers and unresolved
  effects fail closed. An exact idempotent ATA creation with a bounded rent
  debit passes synthetic verifier tests, but no first-time-wallet mainnet quote
  or transaction has been accepted end-to-end.
- The manual `/prepare` route refuses to call Jupiter before a fresh canonical
  issuer product review **and** a server-owned Privy investor eligibility review.
  The `/execute` route rechecks provider, mint, symbol, halt/revocation state and
  investor eligibility before its durable claim. The live adapters currently
  provide neither an AVAILABLE PreStocks review nor an investor review; the
  investor guard deliberately always denies until real reviewed evidence exists.
  Issuer listing, quote availability and this catalog check are not legal clearance.
- A durable owner-bound manual submission ledger, finalized-chain reconciler,
  and status endpoint are wired to the local execute route for both trade
  directions. Migration 0004 has **not** been applied in production. Provider
  acceptance is pending until Solana finality; ambiguous submissions are
  never automatically retried. An owner can recover an unresolved trade or a
  terminal result from the preceding 24 hours after a lost HTTP response. A
  partial unique index also prevents a second unresolved trade for the same
  owner even if two quotes are prepared concurrently. An indefinitely UNKNOWN
  order remains locked until authoritative evidence supports resolution;
  timeout or missing RPC history alone is not permission to release it.
- The current PreStocks catalog adapter does not supply the independently
  reviewed `availability` evidence required by the trade route. Even with an
  investor review adapter, Pre-IPO BUY would still fail closed. The xStocks
  BUY preparer and SELL preparer are not wired to server routes.
- The SELL ledger and reconciler are implemented, but a SELL preparer cannot
  release an order without product, investor, owner-token-account and
  instruction-effect evidence. The current server has no trusted production
  adapters supplying all four decisions.
- There is no successful funded mainnet BUY acceptance for either market. No
  mainnet trade was made as part of this checkpoint.

Read-only quote spot check on 2026-09-25 (no taker address, no executable
transaction, no signature) found some changing Jupiter routes, but **no asset
has been selected as an acceptance-test candidate**. In particular, the
[PreStocks SpaceX page](https://prestocks.com/spacex) currently warns of an
IPO/swap deadline on 12 March 2027; an earlier quote observation must not be
mistaken for a recommendation to test that product. A joint category release
must show BUY only for assets that independently pass all current gates; it
cannot promise every row in the discovery catalog is executable.

The proposed demo investor reports being in Indonesia and not a U.S. person.
The [Backed restricted-country list](https://assets.backed.fi/legal-documentation/restricted-countries)
does not name Indonesia, but this alone is not permission for StockPilot to
distribute or facilitate a particular xStock there; the
[issuer's integration guidance](https://docs.xstocks.fi/docs/exchange-integration)
requires a jurisdiction- and model-specific assessment. The
[PreStocks FAQ](https://prestocks.com/faq?tab=legal) also excludes other
ineligible persons without establishing this investor's eligibility. No
server-owned investor decision or current per-product terms review has been
recorded. The visible "Not for U.S. persons" warning is disclosure, not a
substitute for either gate.

## Joint launch gates

1. Establish the product, distribution venue, user jurisdiction, and any
   eligibility obligations for the selected PreStocks **and** xStocks products.
   This must produce current, auditable, server-owned decisions; a listing in
   an issuer API or a Jupiter route is insufficient. Deny unknown or expired
   evidence.
2. Verify Jupiter keyless rate limits are sufficient for the intended load, or
   provision an optional API credential in protected VPS configuration. Check
   exact-route availability for a small, explicitly selected asset in each
   market. Never commit a credential or put it in client code.
3. Complete and independently review the transaction-effect verifier beyond
   its supported Jupiter V6 exact-in shape, including Token-2022/Scaled UI
   handling, lookup-table resolution, spend and native-SOL caps, token fees,
   slippage, and user-visible minimum output.
   Require a fresh user review and Privy sign-only approval for the exact
   message. The dashboard must not silently sign on behalf of the user.
4. Complete both market preparers under the same verified owner identity and
   checked transaction semantics. The local execute route now makes an atomic
   ledger claim before a single submission and reconciles finalized Solana
   balances; deploy migration 0004 and verify the session-authenticated status
   path before enabling the operator flag. Display pending, failed, and
   finalized states distinctly.
5. Test duplicate/concurrent POSTs, timeouts, restarts, expired quotes,
   changed wallets, revoked sessions, lookup-table changes, malicious
   instructions, excess SOL/token fees, stale product evidence, and unavailable
   issuer/RPC responses. Complete small, explicitly approved mainnet BUY tests
   with the owner's funded wallet for **both** markets and verify the balance
   changes and explorer records before enabling both UI buttons together.

Do not flip `INVESTMENTS_ENABLED`, expose an agent signing permission, or call
the project transaction-complete until these gates are evidenced. SELL and
autonomous agent execution are not implied by a manual BUY release.

Primary references: [Jupiter Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute),
[Jupiter keyless/free limits](https://developers.jup.ag/docs/portal/rate-limits),
[xStocks product/legal overview](https://docs.xstocks.fi/docs/product-legal-overview),
and [PreStocks FAQ](https://prestocks.com/faq?tab=legal).
