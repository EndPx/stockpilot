# Security and deployment review

Review date: 2026-09-23. This records code review and local regression evidence,
not a certification for production financial execution. The intended initial
release offers discovery, wallet authentication and read-only portfolio access.
`INVESTMENTS_ENABLED` defaults to disabled and is fixed to `false` in the supplied
Compose configuration; keep it disabled until the financial blockers below close.

## Scope and deployment status

Reviewed authentication/SIWS, cookies, session checks, portfolio authorization,
request parsing, provider ingestion/cache behavior, transaction authorization,
security headers and the VPS deployment configuration. Threats considered include
replayed requests, copied cookies, forged wallet identity/signatures, request
flooding, oversized upstream data, unavailable storage and untrusted agent input.

The confirmed target is Hostinger VPS `76.13.179.205`, SSH alias
`whisperdesk-vps`, with intended origin `https://stockpilot.endpx.cloud`.
The subdomain A record was added through the user's Hostinger browser and public
DNS resolves to the confirmed VPS. TLS and actual deployment remain separate
checks, not conclusions from the local review.

## Implemented controls and regression evidence

- **One-use sign-in:** five-minute SIWS challenges are signed and registered in
  shared Redis. Atomic consumption precedes proof validation. Regression tests
  reject replay of the exact saved cookie/proof and allow only one concurrent
  verification to issue a session. SIWS verifies the wallet, signature, domain,
  URI, statement, nonce, chain, timestamps and request identifier.
- **Revocable sessions:** signed 24-hour session cookies also require an active
  server-side record. Logout revokes that record. Session, portfolio and
  investment authentication check it; copied revoked cookies fail. Cookies are
  HttpOnly, SameSite=Lax and Secure in production; API responses use no-store.
- **Abuse and input limits:** auth and portfolio use shared atomic counters and
  return `429` with `Retry-After`. Pre-proof wallet limits also include the trusted
  client IP, preventing a caller at another IP from exhausting a victim wallet's
  allowance. Portfolio limits bind to verified sessions/wallets. JSON requests
  require the correct media type and stop reading beyond 16 KiB.
- **Storage failures:** production requires explicit authentication enablement,
  an exact HTTPS origin, a sufficiently long secret and Redis configuration.
  It never falls back to process memory. Redis operations have an absolute
  five-second deadline, bounded queues and connection destruction on timeout;
  uncertain mutations are not automatically retried. Injected-client tests cover
  no-reply and late-connect failures. Development memory storage is bounded and
  rejects capacity exhaustion instead of evicting security records.
- **Provider data:** PreStocks and each xStocks page use a streaming 2 MiB JSON
  limit. Records/metadata are bounded; PreStocks rejects redirects. Both caches
  apply a 15-second refresh-failure cooldown without changing the last successful
  fetch time. Stale output expires after five minutes for PreStocks and thirty
  minutes for xStocks, including during cooldown.
- **Browser defenses:** HTML receives a fresh server-selected script nonce and
  CSP; caller-supplied nonce/CSP headers are replaced. Production scripts do not
  allow `unsafe-eval`. Frame, MIME-sniffing, referrer and permission restrictions
  are configured. Inline styles remain allowed for existing UI rendering.
- **Transaction binding:** authorization commits to the prepared transaction
  message hash and verified wallet. Submitted messages must match that hash, and
  the wallet's Ed25519 signature is cryptographically verified. Wallet sign-in
  proves ownership; it does not authorize a transfer.

## Deployment requirements and residual threats

`TRUST_PROXY=true` is safe only when the private reverse proxy overwrites
`X-Real-IP` and clients cannot reach the app directly. The supplied configuration
binds the app to host loopback and assumes NGINX receives client connections
directly. Adding a CDN or another proxy requires revisiting this trust boundary.

Keep Redis private and persistent, retain its no-eviction policy, protect runtime
secrets and verify backup/restore behavior. A stale Redis restore can resurrect
old security state: rotate the session secret before reopening such a restore.
Monitor storage capacity, persistence failures, timeouts and HTTP errors. These
controls do not establish DDoS resistance, high availability or protection from
a compromised host administrator, wallet, provider or signing secret.

## Financial execution remains blocked

An ambiguous result after submission is not proof that a transaction failed.
Durable idempotency, submission/confirmation reconciliation and a safe recovery
state machine must prevent a timeout from becoming a duplicate purchase. A fresh
transaction or changed quote requires fresh review and authorization.

Matching a transaction hash and valid signature does not prove its instructions
implement the intended investment. A complete instruction-level validator is
still required for permitted programs, accounts, authorities, funding/output
mints, amounts, fees and unexpected transfers or approvals, including address
lookup resolution. Real-wallet acceptance, amount/token-extension semantics,
issuer eligibility and operating procedures require separate validation before
financial enablement. This review is not financial production certification.

## Future agents and MCP

No agent credential, grant, approval service or MCP execution interface has been
implemented or certified here. The design in [PRODUCT_ARCHITECTURE.md](PRODUCT_ARCHITECTURE.md)
must become enforced server behavior before any external agent can act:

- Isolate each account/client with a scoped, revocable credential and grant;
  recheck asset, operation, amount, aggregate budget and expiry constraints.
- Require approval of the exact immutable investment request, followed by an
  independent user-wallet signature. An API key, prompt or SIWS signature cannot
  substitute for either step or expose an arbitrary transaction signer.
- Recheck revocation immediately before execution, make budget/idempotency
  updates atomic, and record attributable audit events without secrets.
- Treat provider metadata, retrieved text, tool output and agent messages as
  untrusted data. Prompt injection must never expand grants, change recipients,
  replace approved transaction details or bypass the approval/signature boundary.

## Validation record

Local targeted regressions cover the controls above using in-process/fake stores
and mocked providers. This report does not claim live Redis persistence/failover,
real-wallet browser acceptance, public TLS or remote deployment tests.

The recorded production dependency audit covered 174 dependencies and reported
zero known advisories. That is a point-in-time advisory result, not a guarantee
against unknown vulnerabilities or application defects.

- Final full test results: 167 passed (89 core/integrations, 38 auth/client/header,
  40 server/portfolio/investment tests), zero failed.
- Final production build result: passed TypeScript and Next.js standalone build.
- DNS, host isolation, live Redis and public/browser acceptance: to be recorded
  by the deployment owner with actual outcomes and remaining limitations.
