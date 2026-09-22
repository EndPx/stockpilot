# xStocks discovery and execution evidence

## Decision — 2026-09-23

The previous production-registry block in `XSTOCKS_VALIDATION.md` is superseded **for read-only discovery only**. All valid official Solana deployments may be discovered. A catalog entry is not permission, technical readiness, or legal clearance to execute.

Three independent concepts:

- Canonicality: an official issuer record, with provider + exact Solana mint as identity. Tickers are searchable metadata, never authorization keys.
- Classification: PRE_IPO (PreStocks exclusively), PUBLIC_EQUITY, ETF, or neutral PUBLIC_MARKET_PRODUCT. Classification needs issuer evidence; absent evidence does not block discovery.
- Execution status: UNKNOWN by default, then a time-bounded validation result: EXECUTABLE, RESTRICTED, UNAVAILABLE, or UNSUPPORTED. Neither a canonical mint nor a quote implies EXECUTABLE.

## Evidence standard

Discovery requires complete bounded pagination of the [official catalog](https://docs.xstocks.fi/apis/openapi/assets), valid explicit Solana deployment, unique issuer ID and mint, and source freshness. Invalid/ambiguous records fail the snapshot; arbitrary request-supplied assets cannot enter it.

Deep validation requires canonical issuer record; underlying instrument and classification provenance; initialized mint, token program and decimals; every extension and its current state; raw/base/scaled amount semantics including scheduled changes; issuer terms and restriction review; and a fresh, identity-checked USDC quote. Record observation time and expiration. Missing evidence fails closed. Unknown extensions do not inherit another product's compatibility.

Validation is read-only. No order, unsigned transaction, wallet interaction, signature, execute endpoint or sendTransaction belongs in this service. A future execution flow must separately enforce user-specific legal eligibility, exact approvals, wallet ownership and fresh transaction authorization; this phase does not connect discovery to the existing BUY path.

## Delivery and verification plan

1. Evolve domain and registry while preserving the PreStocks-only execution/portfolio adapters.
2. Add complete official xStocks ingestion with deterministic bounded search/pagination and tests.
3. Inspect AAPLx, then NVDAx, then TSLAx, sequentially; capture issuer, mint and quote-only findings.
4. Add bigint-safe amount semantics and fail-closed, expiring, bounded lazy validation.
5. Expose public/private Markets and read-only canonical public detail pages. Preserve the charcoal/navy design.
6. Run all regression commands and responsive browser QA, document findings, stop.

Each completed small task is verified, committed and pushed separately. No database, agent/MCP tools, financial execution, sell, scheduling or delegation is in scope.

## Portfolio decision

Keep current PreStocks portfolio admission and valuation unchanged. Public catalog membership alone cannot safely establish scaled quantity/price-unit consistency. xStocks holdings and totals remain postponed until that valuation contract is separately proven; the catalog must never become a list of zero-balance portfolio positions.

## Baseline

Starting commit: `55018a3`; local main matched origin/main and working tree was clean. `pnpm build`, `pnpm test`, `pnpm validate:portfolio-read`, and quote-only `pnpm validate:execution` passed before implementation. No transaction was prepared or executed.
