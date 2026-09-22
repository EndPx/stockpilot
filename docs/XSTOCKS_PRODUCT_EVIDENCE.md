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

## Representative 1 — AAPLx

Observed sequentially first, 2026-09-22T18:14Z (2026-09-23 Asia/Jakarta). The complete production ingestion returned **1,026** canonical Solana products. This is a changing count, not a constant or a tradability claim.

- Official issuer ID `9e43a778-fdc8-44f1-87de-f2e7420bb7f7`; product ISIN `CH1436219187`; underlying Apple Inc., `AAPL`, ISIN `US0378331005`. [Issuer product evidence](https://assets.backed.fi/products/apple-xstock) explicitly identifies tokenized equity exposure via a tracker certificate, not direct share ownership.
- Canonical Solana mint `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`; initialized; Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`; 8 decimals.
- `scaledUiAmountConfig`: stored multiplier `1.0026642075893797`; new multiplier `1.0032690125398187`, effective timestamp `1786149000` (already effective at observation). Do not blindly use the stored old multiplier.
- `defaultAccountState=initialized`; `pausableConfig.paused=false`; `transferHook.programId=null`. Authorities can change these states. Permanent delegate, mint authority and freeze authority are present.
- Other extensions: metadataPointer, tokenMetadata, confidentialTransferMint (autoApproveNewAccounts=false, no auditor). No transferFeeConfig was returned in this mint observation. Absence here says nothing about other catalog products.
- Quote-only: canonical USDC `1000000` raw → AAPLx `291895` raw, Raydium CLMM. This is a time/amount-specific route, not a signed execution or a share quantity.
- Issuer/product terms and geographic/sanctions/venue eligibility remain unreviewed for StockPilot. Discovery stays UNKNOWN; no execution authorization is granted.
