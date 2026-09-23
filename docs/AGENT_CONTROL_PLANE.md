# Agent control plane and MCP foundation

Status: implementation contract, 2026-09-23. This phase creates durable agent
requests and human decisions. It does **not** authorize, prepare, sign, submit,
or retry a Solana transaction. The existing Privy manual-BUY work and all
financial kill switches remain intact.

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

The repository currently has Redis for revocable sessions, rate limits and
short-lived caches, but no relational database. Introduce a private PostgreSQL
service and a small parameterized SQL data layer. Keep Redis's existing security
role. Do not make Redis or a process-local map the source of truth for clients,
credentials, policies, requests, approvals or audit events. Explicit additive
SQL migrations run before a release; the app must not mutate schema at startup.

## Durable entities

| Entity | Ownership and constraints |
| --- | --- |
| Account | Unique Privy user ID, immutable primary Solana wallet binding, timestamps. |
| Client | UUID, account FK, name, descriptive client type, active/revoked status, last-used/revoked timestamps. Names never grant capabilities. |
| Credential | UUID, client FK, display prefix, keyed secret hash, created/used/expiry/revocation timestamps. One active key per client. Plaintext exists only in the creation/rotation response. |
| GrantPolicy | Client FK, fixed `ALWAYS_APPROVE` mode, exact scopes, positive per-request and daily-request USDC limits, provider/market allowlists, version and timestamps. Only the web-session owner may change it. |
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
plus stateless legacy clients. Authenticate `Authorization: Bearer <client key>`
before dispatch; never accept a credential in query parameters. The initial
manually configured client-key mode is **not** an OAuth authorization server or
automatic OAuth discovery flow. Client-specific setup instructions must be
verified against current official client docs before appearing in the UI;
otherwise show generic endpoint/header guidance.

Only six tools are in scope: `list_assets`, `get_asset`, `get_portfolio`,
`request_investment`, `get_request`, `list_requests`. List tools are bounded and
paginated. Portfolio always reads the account's verified wallet. Request input
is exactly canonical `assetId` plus decimal `amountUsd`; provider, mint, wallet,
account, client and policy are resolved server-side. `request_investment` creates
`PENDING_APPROVAL` and an audit event, never calls Jupiter or a signer. A client
can query only its own requests. No execute/sign/send/swap/transfer tool exists.

## Delivery and acceptance

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
