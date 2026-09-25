# Agent control plane and MCP foundation

Current status (2026-09-25): this document began as the September 23 control-plane
foundation and retains its original design/acceptance checklist below. The
current code uses PostgreSQL for durable control-plane state and supports
legacy MCP bearer keys plus opt-in WorkOS OAuth. The newly added market/wallet
MCP reads described here are local implementation, not proof of a production
deployment. Agent BUY, SELL, autonomous execution, signing and submission are
still disabled; local Privy manual-BUY work does not change that boundary.

> Your agent can request. StockPilot enforces. Your wallet approves.

## Boundary and identity

```text
Privy-verified web session → Account → Client → Credential + GrantPolicy
                                                  ↓
                                      authenticated MCP tools
                                                  ↓
                                     immutable InvestmentRequest
                                                  ↓
                                  human Approval + ActivityEvent
                                                  ╳
                                  financial execution (disabled)
```

The server session's `privyUserId` is the account key; its verified primary
embedded Solana address is the wallet binding. Browser and MCP input cannot
select either. On an unexpected wallet-binding change, protected control-plane
operations fail closed until an explicit migration procedure exists. A client
credential identifies exactly one client and account, never a wallet signer.

Redis handles revocable sessions, rate limits and short-lived caches.
PostgreSQL, configured through the server-only control-plane connection string,
is the durable source of truth for clients, credentials, policies, requests,
approvals and audit events. Explicit additive SQL migrations run before a
release; the app must not mutate schema at startup.

## Durable entities

| Entity | Ownership and constraints |
| --- | --- |
| Account | Unique Privy user ID, immutable primary Solana wallet binding, timestamps. |
| Client | UUID, account FK, name, descriptive client type, active/revoked status, last-used/revoked timestamps. Names never grant capabilities. |
| Credential | UUID, client FK, display prefix, keyed secret hash, created/used/expiry/revocation timestamps. One active key per client. Plaintext exists only in the creation/rotation response. |
| GrantPolicy | Client FK, legacy `ALWAYS_APPROVE` field, exact scopes, `buyMode` and `sellMode`, optional per-request and daily-request USDC caps, provider/market allowlists, version and timestamps. Only the web-session owner may change it. `AUTO` BUY and any SELL mode remain rejected by the current service. |
| InvestmentRequest | UUID, account/client FKs, canonical asset ID, provider, market type, canonical output mint, canonical USDC mint, exact six-decimal USDC amount, immutable policy snapshot, creation/expiry and status. No transaction bytes, Jupiter request ID or signature. |
| Approval | One-to-one request FK, account FK, user decision, decision time. The decision does not invoke execution. |
| ActivityEvent | Append-only UUID/time/account/client/request references, event type and bounded nonsecret detail. No edit/delete UI. |

Every query is tenant-scoped by authenticated account, with client-scoped MCP
request reads. Foreign IDs return not found. Database FKs, uniqueness, status
checks and transactional state changes backstop application validation.
Approval transitions: `PENDING_APPROVAL → APPROVED | REJECTED | EXPIRED |
CANCELLED | BLOCKED`. Terminal decisions cannot be changed. Expiry is evaluated
at read/decision time and persisted transactionally; the initial lifetime is 15
minutes. Request contents never mutate; a changed amount, asset or client is a
new request.

Persistence checkpoint: `apps/web/migrations/0001_agent_control_plane.sql` is an
additive migration. `pnpm --filter @stockpilot/web migrate:control-plane` requires
the server-only `CONTROL_PLANE_DATABASE_URL`, takes a PostgreSQL advisory lock,
records a SHA-256 of each applied file and refuses edited migrations. Neither the
web server nor startup automatically runs DDL. PGlite tests execute the complete
SQL and verify immutable intent, terminal decisions, audit append-only behavior
and cross-account foreign-key rejection. This does not substitute for a migration
rehearsal against the exact production PostgreSQL image before deployment.

## Credential and policy rules

Generate at least 256 random secret bits with the platform CSPRNG. Use a
versioned `sp_live_` token containing a nonsecret lookup ID and random secret.
Store only its short display prefix and an HMAC-SHA-256 of the complete token
under a dedicated server-only pepper distinct from `SESSION_SECRET`. Compare
fixed-length digests in constant time. Never log, persist, re-render after
dismissal, or return the plaintext again. Rotation atomically revokes the old
credential, inserts the new one and records audit events. Revocation applies to
the next MCP request. Credential lookup also checks client/account status and
expiry. Rate limits bind to credential and account; failures stay closed.

Operational scopes are only `markets:read`, `portfolio:read`,
`investments:request`, `requests:read-own`, and `approvals:read-own`. No wallet,
transaction, grant-edit or credential-management scope exists for MCP. Request
limits restrict **intent creation**, not future expenditure; any later execution
must independently revalidate the current policy. MVP request creation supports
official PreStocks assets only. xStocks remain discoverable but their unreviewed
eligibility prevents investment requests.

## MCP boundary

Use the maintained official TypeScript SDK v2 `@modelcontextprotocol/server`
and stateless Streamable HTTP on `POST /api/mcp`. The current SDK's
`createMcpHandler` accepts web-standard Request/Response and serves modern MCP
plus stateless legacy clients. Authenticate `Authorization: Bearer <credential>`
before dispatch; never accept a credential in query parameters. The endpoint
accepts existing client keys and configured WorkOS OAuth access tokens. Neither
credential type gives the agent a wallet signing key.

The read tools have separate market and wallet purposes:

| Tool | Current contract |
| --- | --- |
| `list_stocks`, `get_stock` | Search/inspect official xStocks Stocks catalog entries. |
| `list_pre_ipo`, `get_pre_ipo` | Search/inspect official PreStocks Pre-IPO catalog entries. |
| `list_assets`, `get_asset` | Existing combined-market tools retained for compatibility. |
| `get_balance` | Read confirmed Solana RPC SOL and canonical mainnet USDC balances for the authenticated wallet. |
| `get_portfolio` | Read that wallet's canonical PreStocks and xStocks holdings. Investment-position valuation is indicative and may be `null`. |

Market lists are bounded and paginated. Canonical mint addresses originate in
the official issuer catalogs; `tokenPriceUsd` comes from cached indicative
issuer API data, **not** a Solana mint account or an executable trade quote.
The provider-specific detail tools can optionally read Solana mint-account
facts (`program`, `decimals`, `supplyRaw`, authorities and extensions) with
`includeOnChainMint: true` through confirmed RPC. A failed requested RPC read
returns an error rather than invented chain data. It never turns an issuer
price into an on-chain price or establishes trading eligibility.

`get_portfolio` matches on-chain token balances to both canonical catalogs;
its USD estimate covers investment positions, not liquid SOL/USDC. An xStocks
Token-2022 Scaled UI multiplier is not yet verified in this read path, so a
held xStock reports raw token units but `quantity` and `estimatedValueUsd` as
`null`; total `portfolioValueUsd` is also `null` when any position cannot be
valued. Neither the portfolio nor market tools imply PnL or a trade quote.

The remaining tools are `request_investment`, `get_request`, and
`list_requests`. Request input is canonical `assetId`, decimal `amountUsd`,
and a mandatory `clientRequestId` (16–128 URL-safe characters, unique per
client/intent and stable across retries).
Provider, mint, wallet, account, client and policy are resolved server-side.
Reusing an ID with a changed asset or amount is rejected. `request_investment` creates
`PENDING_APPROVAL` and an audit event, never calls Jupiter or a signer. A client
can query only its own requests. No execute/sign/send/swap/transfer tool exists.
Agent BUY, SELL and autonomous execution remain disabled.

## Original delivery and acceptance checklist

The following is the foundation's original release checklist, not a claim that
agent trading or the new MCP tools have completed live acceptance.

Build as small commits: schema/migration, domain/security services, web APIs and
UI, MCP tools, integration/security tests, then deployment. Push each reviewed
commit individually. Do not deploy each commit. Migrations are additive and
reviewed before production; back up the project database before applying them
and retain a rollback image. A rollback to code that does not use the new tables
leaves the tables intact; do not drop data in rollback.

Before deployment: full tests/build, migration rehearsal, MCP client integration
tests, tenant isolation, credential rotation/revocation, policy/concurrency and
expiry tests. Production acceptance may create a Client through the owner's UI,
but automation must not create or print a live client secret. Verify an agent can
create a pending request, the user can reject/approve, and approval explicitly
says execution is unavailable. Confirm the investment endpoints remain disabled
and no funds move.

Protocol references checked 2026-09-23: [MCP TypeScript SDK v2 packages](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md),
[HTTP serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md),
and [authorization guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md).
