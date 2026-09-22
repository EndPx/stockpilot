# Tokenized market discovery closeout

2026-09-23 Asia/Jakarta. Scope: discovery and read-only validation architecture, not investment execution.

## 1. Repository

[EndPx/stockpilot](https://github.com/EndPx/stockpilot), branch `main`.

## 2. Commits

Each implementation increment was verified and pushed separately:

- `1687243` define discovery and execution states
- `8fc856a` separate canonical discovery from execution readiness
- `f774a6a` ingest full canonical xStocks Solana catalog
- `0f6a888` document AAPLx product semantics
- `98210b5` normalize raw and scaled token amounts
- `d1a685c` classify representative products using issuer evidence
- `d74eff7` add fail-closed lazy execution validation
- `9fe7ef2` add bounded search and cursor pagination
- `5935f08` expose public/private market discovery
- `dff3572` enforce classification evidence and issuer availability gates
- `4bc94b0` exclude evidenced private exposure

This report and updated project documentation form the final closeout commit.

## 3. Current source catalog count

The final read-only CLI run at `2026-09-22T18:43:26Z` read **1,026** canonical Solana products through all 11 official API pages. This is an observation, not a hardcoded expected count. [Official API](https://docs.xstocks.fi/apis/openapi/assets).

## 4. Admitted discovery products

**1,025 xStocks**, plus **8 PreStocks** = **1,033** total. VCXx is excluded because the issuer documents private-company exposure. The owner explicitly confirmed that policy on 2026-09-23. Exclusions match mint, issuer ID or underlying ISIN, not ticker. The remaining catalog stays discoverable; this is not a three-stock whitelist or an exhaustive underlying-holdings audit. [VCX issuer evidence](https://xstocks.com/news/xstocks-and-fundrise-partner-to-tokenize-vcx-fund-unlocking-onchain-exposure-to-leading-private-tech-companies).

## 5. Classification breakdown

| Classification | Count |
| --- | ---: |
| PRE_IPO / PreStocks | 8 |
| PUBLIC_EQUITY / xStocks | 3 |
| ETF / xStocks, verified | 0 |
| PUBLIC_MARKET_PRODUCT / xStocks | 1,022 |

Zero verified ETFs does not mean the catalog contains no ETFs. Current API records omit explicit underlying type; unknown records remain neutral.

## 6. Generic products

**1,022** admitted public products remain generic. No classification is inferred from ticker, name or logo.

## 7. Representative deep validation

AAPLx, then NVDAx, then TSLAx were inspected sequentially. Issuer record, underlying security, product ISIN, mint, program, initialization, decimals, extension states, amount behavior and diagnostic quotes are documented in [product evidence](XSTOCKS_PRODUCT_EVIDENCE.md). This establishes findings, not complete execution compatibility.

## 8. Canonical mints

| Product | Solana mint |
| --- | --- |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` |

Registry identity is `provider:canonicalMint`; ticker is only display/search metadata.

## 9. Token programs

All three sampled mints are initialized Token-2022 mints owned by `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. No whole-catalog extrapolation is made.

## 10. Decimals

All three samples use **8 decimals**. Raw amounts remain canonical u64 strings, with bigint arithmetic.

## 11. Scaled amount findings

Effective multipliers at the final probe: AAPLx `1.0032690125398187`, NVDAx `1.001701196801074`, TSLAx `1`. Scheduled new multipliers activate at their timestamp, and bound validation expiry. Same-context RPC `uiAmountString` is preferred and never scaled twice. Exact-decimal local calculations are labeled `DECIMAL_SCALE_ESTIMATE`: Token-2022's binary-float implementation can differ at rounding boundaries, particularly for large u64 values. They are not used for production sizing or xStocks portfolio valuation. [Solana integration guide](https://solana.com/docs/tokens/extensions/scaled-ui-amount/integration-guide).

## 12. Extensions

All samples expose metadataPointer, permanentDelegate, defaultAccountState, scaledUiAmountConfig, pausableConfig, confidentialTransferMint, transferHook and tokenMetadata. Pause=false; default state=initialized; hook program=null. Mint/freeze/delegate/pause/scale authorities exist. No TransferFee was observed in these samples. Authorities and future state changes matter; route availability cannot override them. Unknown extensions, active hooks and unsupported fees fail closed. Wallet signing and individual wallet token-account behavior were not tested.

## 13. Jupiter quote-only findings

Final diagnostic input: canonical USDC, `1000000` raw (1 USDC), ExactIn.

| Output | Raw quote output | Venue |
| --- | ---: | --- |
| AAPLx | 292111 | Raydium CLMM |
| NVDAx | 435402 | Whirlpool |
| TSLAx | 263574 | Whirlpool |

These are expiring observations, not offers or permanent routability. Only GET quotes occurred; no order, unsigned transaction, signing, execute or send call.

## 14. Execution status

Canonicality, classification and readiness are independent. Catalog records remain `UNKNOWN`. Technical validation can return `EXECUTABLE`, `RESTRICTED`, `UNAVAILABLE` or `UNSUPPORTED`, with findings and expiry. **All three live samples returned UNAVAILABLE / PRODUCT_AND_TOKEN_REVIEW_REQUIRED**. No production product-review clearance is configured. Positive transitions exist only in synthetic tests.

## 15. Just-in-time validation

`ExecutionEligibilityService.validateForExecution(assetId)` resolves a fresh canonical snapshot, inspects one selected mint, evaluates extensions/amounts/restrictions and requests a diagnostic quote. Results are bounded to 128 cache entries, 8 concurrent validations and 30-second TTL, capped by evidence expiry and scheduled scale changes. Stale registry, unknown issuer availability, missing evidence, malformed state and outages fail closed. It is not wired into investment preparation or exposed as an expensive public endpoint. Future preparation requires fresh wallet/account-specific checks and separate user authorization.

## 16. Registry and search

Official paginated issuer ingestion rejects malformed/ambiguous/duplicate deployments and never uses Jupiter ticker search for canonicality. Per-process xStocks cache: 5-minute fresh, at most 30-minute explicitly stale fallback. Search covers canonical ID, name, symbol, provider, description and underlying metadata. Public GET `/api/markets` supports group/provider/marketType/query/limit/cursor. Query-bound keyset pagination caps responses at 100; UI uses 30. Private-only browsing does not require xStocks availability.

## 17. Portfolio decision

Existing authenticated PreStocks/USDC/SOL portfolio remains unchanged. xStocks admission is postponed until RPC-scaled quantities and valuation price units are validated together. Catalog membership never creates a holding; zero-balance catalog entries are not added to Portfolio.

## 18. Markets UI

Live All / Private Markets / Public Markets filters, deterministic search, bounded server-rendered rows, dynamic counts, source timestamps, loading/error/stale/empty recovery and next/first pagination. Public details use canonical mint routes and readonly identity/issuer information, without BUY controls. Existing PreStocks details and investment components remain intact. Landing copy distinguishes live discovery from future execution/agents. The frontend skill guided reuse of the existing charcoal/cobalt design, accessible filter controls and server-rendered bounded lists rather than a separate visual system.

## 19. Restrictions

Issuer legal documentation identifies restrictions including US-person and sanctions constraints; this is not a complete product/jurisdiction eligibility review. Metadata explicitly marks review incomplete. No invasive geolocation or restrictions bypass was added. A quote is not legal eligibility. [Issuer legal documentation](https://assets.backed.fi/legal-documentation).

## 20. PreStocks invariant

PRE_IPO is restricted to PreStocks at type and runtime boundaries. Tests reject xStocks/private pairs, unknown providers, arbitrary SPL identities and forged ticker/mint lookup. VCXx private exposure is excluded even though its underlying fund is publicly listed; aliases cannot bypass mint/issuer/ISIN matching. Other proven private-exposure exclusions can be added with issuer evidence, without concealing the remaining generic universe.

## 21. Tests

`pnpm test`: **132/132 passing** (74 core/integration, 23 web client/auth, 35 server/API). Coverage includes catalog pagination, canonicality, duplicate/malformed records, collisions, private-exposure exclusion, search/cursors, classification evidence, lazy status transitions/expiry, issuer outages, extension gates, exact raw amounts and existing auth/investment/portfolio regressions.

## 22. Build

`pnpm build`: passed root TypeScript and Next.js 16.3.5 production build, including public Markets API and mint-based public detail route.

## 23. Regression results

`pnpm validate:portfolio-read`: passed mainnet native balance and 12 legacy SPL/Token-2022 accounts. `pnpm validate:execution`: passed eight official PreStocks, initialized SPACEX mint and 1-USDC quote via Meteora DLMM (estimated 0.001739774 SPACEX). Both are read-only. Existing wallet, SIWS, investment authorization, execute and portfolio implementation files were not changed. Real-wallet sign-in/funded execution was not repeated or claimed. Browser evidence and remaining frontend measurement debt are in [UI QA](UI-REDESIGN-QA.md).

## 24. Blockers and limitations

Public execution remains deliberately blocked by incomplete product/token/restriction review and wallet/account-specific compatibility, not by missing discovery. Portfolio amount/price alignment remains postponed. Full cold issuer pagination took roughly 50 seconds in local QA; the loading shell is prompt, but cold data availability is not instant. Warm queries use memory cache; no persistent cache/database was introduced. React Doctor reports 72/100, zero errors and eight warnings (seven existing, one Markets render-complexity warning). Lighthouse medians, render budgets, exhaustive holdings classification and universal wallet compatibility are not certified.

## 25. Recommended next smallest task

Improve and measure cold catalog refresh latency within the read-only discovery boundary, preserving complete pagination, exclusions, stale limits and fail-closed errors. Do not start execution, agent tooling, credentials, database, sell or automation automatically. Any later public execution work needs a separately approved, one-product compatibility and eligibility review first.
