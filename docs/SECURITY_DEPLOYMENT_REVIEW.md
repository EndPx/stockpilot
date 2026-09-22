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
The subdomain A record was added through the user's Hostinger browser (TTL 14400)
and public DNS resolves to the confirmed VPS. No other DNS record was changed.
The live origin is **https://stockpilot.endpx.cloud**. Release `4ffe7e2` runs from
`/opt/stockpilot/releases/4ffe7e2`, with `/opt/stockpilot/current` pointing to it.
The app image is `stockpilot:release-4ffe7e2` with resolved image ID
`sha256:0cb36bb217249b37456c1fffcb5ce89d169675ed0b4ec4767ca19035f6e61eac`.
The earlier hardened image `stockpilot:release-11d9809` is retained for rollback.

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

Local regressions cover the controls above using in-process/fake stores and mocked
providers. Live smoke tests additionally exercised the actual HTTPS/Redis auth
path and read-only Solana portfolio adapter using an ephemeral unfunded identity.
This is not acceptance with the user's Phantom wallet, a funded-wallet test,
mainnet investment acceptance, a disaster-restore test, or an external penetration
test. No financial transaction was signed, prepared or broadcast.

The recorded production dependency audit covered 174 dependencies and reported
zero known advisories. That is a point-in-time advisory result, not a guarantee
against unknown vulnerabilities or application defects.

- Final full test results: 167 passed (89 core/integrations, 38 auth/client/header,
  40 server/portfolio/investment tests), zero failed.
- Final production build result: passed TypeScript and Next.js standalone builds
  locally on Windows and inside the Linux production Docker build.
- Public HTTP redirects to HTTPS; HTTPS landing returns 200. Let's Encrypt
  certificate covers this hostname and expires 2026-12-21; Certbot timer is active
  with a domain-scoped NGINX renewal hook. Combined `nginx -t` passed before reload.
- Both StockPilot containers are healthy, non-root and read-only. App binds only
  `127.0.0.1:3100`; Redis publishes no host port and its network is internal.
  External checks could not reach ports 3100 or 6379. Runtime config is root-owned
  mode 0600 inside mode-0700 `/etc/stockpilot`. No dotenv files were found in the
  runtime image. Existing unrelated containers remained running.
- Redis reports AOF enabled and successful last writes/rewrite status. Its volume
  survived app-only replacement. Redis restart, failover and backup restoration
  were not exercised, and monitoring/backup operations still need operator setup.
- `node deploy/smoke-auth.mjs --portfolio`: all eleven checks passed on the final
  release. Verified secure cookies, real SIWS proof validation, restored sessions,
  empty wallet-bound on-chain portfolio, rejection of identical proof replay,
  logout revocation, foreign-origin rejection and both disabled investment gates.
- Additional live checks: unauthenticated portfolio returns 401; oversized API
  request returns 413; HTML CSP nonce differs per response; framing/MIME/referrer/
  HSTS headers are present; health reports auth enabled, investments disabled and
  agent execution disabled. Rate-limit behavior is covered by local tests and
  deployed configuration; a public stress/flood test was not performed.
- Browser checks: landing, app sign-in entry, Markets (1,033 catalog products at
  the time of inspection), PreStocks detail, disabled-execution notice and copy
  interaction loaded successfully. No browser warning/error logs were observed.
  Real Phantom sign-in and non-empty portfolio rendering remain user acceptance.
