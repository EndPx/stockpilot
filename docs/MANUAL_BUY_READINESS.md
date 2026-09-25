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
- The transaction-effect verifier now accepts the xStocks BUY preparer's
  canonical USDC-input shape and enforces the stricter of the server product
  floor and its 1% maximum-slippage floor. Its separate unsigned-envelope
  check rejects an unexpected signer. These offline checks do not establish
  that a live Jupiter order uses the one supported instruction layout.
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

A further keyless, read-only spot check returned indicative Metis quotes for
one AAPLx and one Polymarket PreStocks catalog mint. Requesting an assembled
AAPLx order for an unfunded synthetic test wallet returned `errorCode: 1`
without transaction bytes. Neither quote is an executable or suitability
decision; no wallet signed, submitted, or funded a trade in this check.

Focused demo-wallet probe on 2026-09-25 (read-only, no signature or submission):

- The owner selected Polymarket PreStocks mint
  `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` and AAPLx mint
  `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` for prospective
  USDC 0.10 BUY tests. This is a test preference, not an eligibility approval.
- Mainnet RPC reported 0.003 SOL and 1.353841 USDC at the confirmed public
  wallet `6EuMFHPtiyoFtsBTy1hiJpNgupP7qkZfZm9ErQ58ipsC`. It had no
  destination token account for either product. These are a point-in-time
  observation; refresh before any transaction attempt.
- Both mints use Token-2022. The RPC minimum rent quote for a 170-byte token
  account was 0.00151384 SOL, so two such accounts require at least
  0.00302768 SOL, already greater than the reported SOL balance before
  network fees. Actual account sizing and fees must be checked again.
- Jupiter `/order` without a taker returned indicative USDC 0.10 quotes;
  an owner-bound Polymarket `/order` returned `errorCode: 3` (below the
  gasless minimum), without an executable transaction. `/build` returned
  raw instructions for USDC 0.10, but uses `route_v2` and cannot be sent
  through the existing `/order` + `/execute` adapter. The observed AAPLx
  `/build` route had multiple DEX legs and two setup instructions.
- Forcing direct, read-only legacy quotes produced a one-leg Manifest route
  for Polymarket and a one-leg Raydium CLMM route for AAPLx. Neither is the
  sole Raydium classic instruction variant decoded by our strict verifier.
  Restricting Polymarket quotes to Raydium or Raydium CLMM returned no route.
- Both mints expose Token-2022 extensions outside the current verifier's
  display-only allowlist, including transfer hooks. Treating a quote or
  simulation as a proof of all wallet debits would weaken the agreed strict
  verification boundary. No BUY/SELL or autonomous policy was enabled.

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
