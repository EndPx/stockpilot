# xStocks validation

> Historical architecture-correction findings below. Superseded for **discovery** on 2026-09-23 by [product evidence](XSTOCKS_PRODUCT_EVIDENCE.md) and the [discovery closeout](TOKENIZED_MARKET_DISCOVERY_REPORT.md): the full issuer catalog is ingested, with evidence-backed private-exposure exclusions. Public execution remains disabled; the old production-discovery block no longer applies.

Decision: **XSTOCKS CANONICAL REGISTRY BLOCKED** for production activation.

Canonical **discovery is proven**, not missing. The blocker is completing a safely classified, extension-aware and eligibility-reviewed production registry. Do not confuse this decision label with an inability to find official mints. No production xStocks provider or public-stock trading/category UI is enabled by this change.

## Primary sources and canonical discovery

- [Official API reference](https://docs.xstocks.fi/apis/openapi) identifies the production host `https://api.xstocks.fi/api/v2`; public endpoints do not require credentials.
- [Issuer asset API](https://docs.xstocks.fi/apis/openapi/assets) and its linked [OpenAPI schema](https://docs.xstocks.fi/_bundle/apis/@v2/openapi.json?download=) define paginated `GET /public/assets?network=Solana&pageSize=100&page=0` and `GET /public/assets/{symbol}`. Metadata includes issuer ID, symbol, description, logo, underlying, halt flags and deployments. Use the exact Solana deployment address, not EVM/wrapper addresses. Finish pagination, validate address syntax and reject duplicate/ambiguous IDs or mints.
- [Issuer legal/product documentation](https://assets.backed.fi/legal-documentation) links canonical product contracts and product-specific terms. Link each product to that issuer evidence; random token lists and Jupiter ticker search are not issuer verification.

This is the authoritative discovery chain: issuer documentation → issuer HTTPS API → explicit Solana deployment → initialized mint account on mainnet → per-product classification/extension/eligibility review. A matching ticker or token-program owner alone proves neither issuer nor category.

## Live read-only findings

Probe: `pnpm exec tsx src/validate-xstocks.ts`. Ran 2026-09-23 Asia/Jakarta, at approximately `2026-09-22T17:11:00Z`. Only catalog GETs, Solana reads and Jupiter GET quote; no user wallet, transaction construction, signature or submission.

| Check | Result |
| --- | --- |
| Complete issuer pagination | 11 pages, 1,026 rows; final hasNextPage=false |
| Canonical Solana candidates | 1,026 unique issuer IDs and unique, syntactically valid Solana deployment addresses |
| Explicit underlying Equity/ETF classification | **0**; `underlying.type` was null for all 1,026 rows |
| Public-equity production registry entries admitted | **0** (not 1,026 verified tradable public equities) |
| On-chain mint verification | **1 sampled mint**, AAPLx; not an all-catalog chain audit |
| AAPLx mint | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` |
| Program | Token-2022: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Mint state / decimals | Initialized mint / 8 decimals |
| Jupiter quote | 1 USDC (`1000000` raw) → `291197` raw AAPLx, Raydium CLMM route |

Counts/quote are a point-in-time result, not a hardcoded allowlist or guarantee. The public API contains an underlying type field but the observed data does not populate it. Do not label every issuer deployment PUBLIC_EQUITY based only on a symbol suffix. The sample's Apple identity is also visible on the [official product/integration site](https://xstocks.com/partner); that is not a substitute for a reviewed machine-readable classification of the whole catalog.

## Token behavior and integration risk

The AAPLx sample exposed `metadataPointer`, `permanentDelegate`, `defaultAccountState`, `scaledUiAmountConfig`, `pausableConfig`, `confidentialTransferMint`, `transferHook`, and `tokenMetadata`. These observations do not establish the state/authority of every extension on every asset. Inspect all mint extension settings before production allowlisting, including active pause/hook/freeze/delegate behavior. Do not assume legacy SPL semantics or advertise that issuer controls cannot exist.

[xStocks exchange integration](https://docs.xstocks.fi/docs/exchange-integration) requires Solana scaled-UI handling: raw units stay fixed while the displayed quantity changes. [Corporate action documentation](https://docs.xstocks.fi/docs/dividends-and-stock-splits) explains scheduled multipliers and recommends pausing affected interactions around activation. Preserve integer raw amounts for execution; account for decimals and effective multiplier in displayed balances and matched price units.

[Solana's integration guide](https://solana.com/docs/tokens/extensions/scaled-ui-amount/integration-guide) recommends UIAmountString for display and raw amounts/non-scaled prices for internal math. Avoid multiplying an already scaled RPC result again. [Permanent delegate documentation](https://solana.com/docs/tokens/extensions/permanent-delegate) describes mint-wide transfer/burn authority; [extension reference](https://solana.com/docs/tokens/extensions) includes pause and hook capabilities. A visible extension name alone does not reveal whether its optional authority is active.

StockPilot currently normalizes balances from raw amounts and decimals for its PreStocks-only portfolio. That is **not sufficient evidence of correct xStocks valuation**. No broadening of that path was made. Add fixtures for multiplier=1, non-unit multiplier, effective-time changes, price-unit consistency and rounding before xStocks holdings enter portfolio totals.

## Routing

The live AAPLx quote verifies one canonical USDC route at one amount/time. It does not prove every catalog asset is routable, that a signed transaction would execute, or that a user is eligible. Output above is intentionally raw, not a potentially misleading scaled share amount. Check halt/corporate-action state and obtain a fresh route only after registry and eligibility checks. No automatic quote retries or transaction execution were performed.

## Geographic and issuer obligations

[Official partner guidance](https://xstocks.com/partner) excludes US persons/US distribution and currently names Canada, the UK and Australia as restricted. It places geographic compliance and platform-level KYC obligations on integrating venues. Treat this as a non-exhaustive, changing restriction set—not a four-country allowlist complement.

[Legal documentation](https://assets.backed.fi/legal-documentation) describes tracker certificates rather than direct ownership of underlying company shares, qualified-investor conditions for direct issuer purchases, sanctions restrictions and product/venue-specific terms. Direct issuance conditions must not be blindly equated with every secondary venue's policy. [Legal overview](https://docs.xstocks.fi/docs/product-legal-overview) and product final terms require review for StockPilot's operating jurisdiction and distribution model. A successful on-chain quote does not waive these obligations. This research is not legal clearance.

No partner application, account signup, terms attestation, KYC submission or geolocation request was made. Model availability status, issuer terms URL, restricted-jurisdiction metadata and review completeness; missing review defaults closed. Production enablement requires owner/issuer/compliance decisions outside this code task.

## Unblocking sequence

1. Establish issuer-backed Equity/ETF classification for a small canonical subset (or obtain authoritative population of `underlying.type`); record per-product terms/provenance.
2. Verify each selected mint and extension settings; implement/test correct scaled display versus raw execution math and halt handling.
3. Resolve jurisdiction/eligibility requirements for StockPilot and implement the approved non-invasive gate.
4. Separately activate a read-only provider, then category UI and grouped portfolio. Migrate investment requests to assetId and prove authorization bindings before expanding human BUY execution.

The current correction stops here. PreStocks exclusivity for PRE_IPO is unchanged, and no xStocks pre-IPO assumption is permitted.
