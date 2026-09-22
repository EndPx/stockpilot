# Architecture correction closeout — 2026-09-23

This is the requested architecture/validation stop point, not permission to resume
financial execution. No transaction was prepared, signed or submitted in this task.

| # | Requested report item | Result |
| --- | --- | --- |
| 1 | Repository | https://github.com/EndPx/stockpilot, branch main |
| 2 | Commits | `8ec67cc` PayBox research; `28b4187` architecture; `2da8a17` classifications; `e9d567f` registry; `f82fbbe` xStocks validation; `88ae613` original landing and retained app redesign. Each pushed separately; this closeout/index update is a separate final documentation commit. |
| 3 | Authenticated PayBox inspection | Available in owner's existing session. Approvals, Agents (`/clients`), one client detail and Credentials read-only. No login or mutations. |
| 4 | Observed vs documented concepts | Observed grant rows, client status/expiry/activity, wallet credential groups and pending-empty approvals. Public docs supply operation-bound lifecycle, client isolation, grant checks, polling and revocation. Detailed evidence/limits in PAYBOX_PRODUCT_RESEARCH.md. |
| 5 | Clients | One external AI integration per isolated account-owned identity, credential set, policy, audit and revocation state. Design only. |
| 6 | Credentials | StockPilot-issued client authentication, never wallet private keys. One-time plaintext display; secure hash plus identity/prefix/lifecycle metadata only. No issuance endpoint implemented. |
| 7 | Approvals | Immutable exact operation, bound to client/account/wallet/asset/provider/category/mints/amount/message/expiry. Human approval and wallet signature separate; MVP ALWAYS_APPROVE. Nine explicit request states documented. |
| 8 | xStocks canonical source | Official docs → `api.xstocks.fi/api/v2/public/assets`, full pagination and explicit Solana deployment; not Jupiter ticker search. |
| 9 | Discovery counts | 1,026 canonical Solana candidates; 0 explicitly classified Equity/ETF by the current API field; 1 initialized on-chain mint sample (AAPLx); 0 production public assets admitted. These counts are distinct. |
| 10 | Token characteristics | AAPLx: Token-2022, 8 decimals; scaled UI, delegate, pause, default-state, hook and other extensions observed. Not an all-mint audit. |
| 11 | Jupiter routing | Live quote-only 1 USDC → AAPLx through Raydium CLMM. Proves one sample route, not execution, all-catalog routing or legal eligibility. |
| 12 | Restrictions | Issuer partner guidance names US/person restrictions, Canada, UK, Australia; sanctions and venue/product-specific requirements also apply. No globally-available claim, eligibility attestation or geolocation performed. |
| 13 | Asset architecture | Discriminated market/provider pair, stable `<provider>:<mint>` identity, registry list/search/ID/mint/filter/eligibility API; fail-closed duplicate/impersonation/unknown cases; legacy PreStocks service retained. |
| 14 | Bounty invariant | PRE_IPO only allows prestocks. xstocks only pairs with PUBLIC_EQUITY. Required five safety cases plus registry negative cases pass. |
| 15 | UI | Header only logo + Open the app; original generated orbital hero; revised product positioning and explicit in-development labels. Prior dashboard/Markets/detail work preserved. No public-market filter or fake control-plane navigation enabled. |
| 16 | Tests | 102/102 passed: 47 root tests, 23 auth/wallet/UI, 32 routes/adapter tests. Both requested live read-only validation commands passed. |
| 17 | Build | `pnpm build` passed; root and Next TypeScript passed; landing prerendered static and image optimized. |
| 18 | Regressions | No regression observed: live 8-asset PreStocks catalog, search/detail, session-bound portfolio, connected Phantom and wallet dialog retained. SIWS automated suite passes; existing signed-in browser session verified without requesting a fresh signature. |
| 19 | Blockers | XSTOCKS CANONICAL REGISTRY BLOCKED for production classification/scaled-amount/extension/eligibility completion; official discovery itself proven. Mainnet investment acceptance still unproven. Full Lighthouse medians/render-budget/200%-zoom/screen-reader QA not completed; 7 existing React Doctor warnings remain (0 errors). |
| 20 | Next smallest task | Validate an issuer-backed Equity/ETF classification for one or a few canonical Solana products, with recorded legal/product evidence and owner-confirmed eligibility approach. Then separately implement/test scaled amount handling. Do not proceed automatically to agent or investment execution. |

## Boundaries preserved

- No agent signer, wallet secret storage, autonomous trade, sell, database, MCP or automation.
- No PayBox credentials revealed, copied, issued, changed or revoked.
- No production xStocks provider implemented from unclassified catalog rows.
- All current execution endpoints remain human-wallet-only and PreStocks-only.
- Research probes use public issuer/RPC/quote data; no private wallet is sent to a new provider.

## Visual implementation and QA

The frontend skill guided the design contract, responsive original layout and browser
verification. The imagegen skill produced a decorative local artwork via the built-in
generator; the vector logo remains original and unchanged. Prompt and asset path:
[IMAGE_PROVENANCE.md](IMAGE_PROVENANCE.md). QA evidence and outstanding limits:
[UI-REDESIGN-QA.md](UI-REDESIGN-QA.md). No current Lighthouse score is claimed.
