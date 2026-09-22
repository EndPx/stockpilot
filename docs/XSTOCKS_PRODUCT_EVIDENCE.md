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

## Amount contract

`token-amounts.ts` preserves raw u64 strings, formats base amounts using bigint, selects the new multiplier at/after its effective timestamp, and computes an exact decimal-rational scaled estimate truncated to mint decimals. It accepts a same-context RPC `uiAmountString` as the preferred display value and never scales that value again.

Important limitation: [Token-2022's implementation](https://github.com/solana-program/token-2022/blob/main/interface/src/extension/scaled_ui_amount/mod.rs) performs binary f64 conversions internally. An exact decimal calculation is **not** guaranteed bit-identical to RPC formatting near rounding boundaries or for large u64s. The utility labels its fallback `DECIMAL_SCALE_ESTIMATE`, not an authoritative balance; `RPC_SCALED` identifies the already-scaled RPC string. Neither path converts raw u64 to Number or is used for investment sizing/portfolio valuation. This is why public portfolio totals remain deferred.

Reference: [Solana integration guidance](https://solana.com/docs/tokens/extensions/scaled-ui-amount/integration-guide). Multiplier updates/corporate actions require fresh context; displayed amounts cannot serve as permanent raw execution amounts.

## Representatives 2 and 3 — sequential observations

| Observation | NVDAx (18:15:31Z) | TSLAx (18:17:23Z) |
| --- | --- | --- |
| Date | 2026-09-22 UTC | 2026-09-22 UTC |
| Issuer ID | 0997ed45-6a34-4f26-be92-28d8e0f9f28a | 96f43a87-976b-4076-ac84-394966c32a90 |
| Product ISIN | CH1436219195 | CH1436219252 |
| Underlying | NVIDIA Corporation, US67066G1040 | Tesla Inc., US88160R1014 |
| Mint | Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh | XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB |
| Program / decimals | Token-2022 / 8, initialized | Token-2022 / 8, initialized |
| Stored multiplier | 1.0009180758490996 | 1 |
| New multiplier | 1.001701196801074 | 1 |
| Effective timestamp | 1789000200 (already effective) | 0 |
| 1 USDC quote output, raw | 435716 | 263942 |
| Route | Manifest | BinaryFi |

[NVIDIA issuer evidence](https://assets.backed.fi/products/nvidia-xstock) and [Tesla issuer evidence](https://assets.backed.fi/products/tesla-xstock) establish public-equity underlying exposure through tracker certificates. The classification overlay binds canonical mint, issuer ID, product ISIN and underlying ISIN; it is not a three-product discovery whitelist. Other records remain generic unless the official API explicitly supplies Equity or ETF classification.

All three sampled mints returned the same eight extension names, but different scale values. Their default account states were initialized, pause flags false, and hook program IDs null. All had permanent delegate, freeze, mint, pause and scale authorities. This does not prove compatibility for every possible wallet/account or for the rest of the catalog.

## Extension implications

| Extension / control | Read/display | Transfer, route and signing implications |
| --- | --- | --- |
| scaledUiAmountConfig | Preserve raw; effective-time scaled display; already-scaled RPC string preferred | Corporate actions change display, not raw units. Quotes use raw. Price units and wallet presentation need independent review. |
| transferHook | Standard public balance still readable | Active program may require extra accounts or reject transfers. Null today can change under authority; unknown/active hooks fail closed. |
| pausableConfig | Balance readable while paused | Pause blocks transfers. Require fresh state; no quote can override it. |
| defaultAccountState / freeze authority | Does not change amount | Frozen default/account can block receipt/transfer. Individual user token-account state is a future prepare prerequisite. |
| permanentDelegate | Does not change amount formatting | Issuer can transfer/burn under its authority. Disclose and review; do not imply user-exclusive control. |
| metadataPointer / tokenMetadata | Display metadata only; not canonicality proof | Token name/symbol cannot override issuer mint identity. |
| confidentialTransferMint | Public balances remain distinct from confidential balances | No confidential-account/decryption support. Its presence is not evidence that every transfer is confidential; execution compatibility still requires review. |
| transferFeeConfig (not observed in samples) | Raw balance remains integer; withheld fees are separate | Net output/fee epochs require dedicated support; currently unsupported. |
| Unknown extensions | Never assume another asset's semantics | Unsupported until reviewed. |

No wallet signing or transaction simulation occurred, so signing/execution compatibility is **not proven**. Current issuer terms restrict US persons and sanctions-related access; product/venue/jurisdiction review remains incomplete, not an exhaustive allowlist. No geolocation or eligibility bypass is implemented.

## Lazy validation boundary

`ExecutionEligibilityService.validateForExecution(assetId)` performs a fresh canonical snapshot lookup before consulting its bounded cache, then reads the selected mint, checks extension/amount behavior, reviews server-owned product evidence and requests a fixed 1-USDC diagnostic quote. Only the selected product is inspected. Results contain status, reason, findings, validatedAt and expiresAt. Up to 128 results, 8 in-flight validations, 30-second TTL, same-asset request coalescing, immutable outputs; expiry is also capped by upcoming scale activation and product-review expiry.

No production product-review clearance is configured. Therefore the sampled products return UNAVAILABLE / PRODUCT_AND_TOKEN_REVIEW_REQUIRED even when quotes succeed. Known pause/freeze/halt restrictions return RESTRICTED; active hooks, fees and unknown extensions return UNSUPPORTED. Missing routes return UNAVAILABLE. Tests exercise EXECUTABLE only with synthetic complete server-owned evidence. It is a technical result, never user authorization or proof that any wallet/account can sign/transfer.

The validator is a core service and a read-only CLI (`pnpm validate:xstocks`), not a public expensive endpoint, MCP tool or connection to investment prepare. Catalog pages do not trigger 1,026 mint/quote checks. Listing status remains UNKNOWN; expiring readiness is deliberately not persisted into issuer metadata. A future financial flow must revalidate near preparation, inspect the actual wallet accounts, apply user-specific restrictions/approvals and bind transaction authorization independently.
