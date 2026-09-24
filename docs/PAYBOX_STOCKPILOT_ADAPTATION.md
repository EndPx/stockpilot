# PayBox patterns adapted to StockPilot

This document records the investment-only adaptation of PayBox's public
[OAuth](https://docs.paybox.sh/connect/oauth),
[MCP](https://docs.paybox.sh/connect/mcp),
[grant and approval](https://docs.paybox.sh/concepts/model), and
[request lifecycle](https://docs.paybox.sh/concepts/requests) documentation.
It is an implementation contract, not a claim that StockPilot has PayBox's
wallet, passkey, card, secret, x402, or plugin infrastructure.

## Separate authorities

1. Privy identifies the StockPilot user and owns the embedded Solana wallet.
   The verified Privy user ID and primary wallet address, never an email or
   agent-supplied address, bind the StockPilot account.
2. A managed OAuth authorization server authenticates MCP clients. It must
   redirect to StockPilot's existing Privy login, issue resource-bound,
   short-lived tokens, and support revocation. Neon stores StockPilot's
   account/client/grant/request/audit records; a database is not by itself an
   OAuth authorization server.
3. A per-agent StockPilot grant determines allowed reads, BUY/SELL request or
   execution mode, asset universe, time, and spending policy. The grant is
   checked at each operation, independently of a valid OAuth token.
4. Wallet signing is a separate authority. Neither OAuth login nor a BUY
   checkbox constitutes permission for the server to sign on behalf of a user.
   Server-side Privy signing needs explicit user delegation, restrictive Privy
   policy and authorization key, and StockPilot's own enforced limits.

## Connector flow

The user enters StockPilot's HTTPS MCP URL in a supported host. MCP protected
resource metadata points to the authorization server. The host performs
authorization-code with PKCE S256 and an exact redirect URI. StockPilot maps a
verified token to the existing Privy account through an immutable provider ID,
never by matching an email address. The connected client starts with no
financial execution capability. The account owner can later edit its grant or
revoke it. Existing manually issued keys may remain for compatibility, but are
not the primary onboarding path.

OAuth access tokens remain bearer credentials in the HTTP Authorization header.
StockPilot must not put them in URLs, logs or its own browser storage; the MCP
host is responsible for protecting the tokens it receives. The MCP server
verifies signature, issuer, exact audience/resource, expiry, scope, account and
current grant on each request. A revoked grant must stop access even before a
token expires.

## Investment request lifecycle

An agent sends only a canonical investment intent, never a Solana transaction,
wallet key or arbitrary mint. StockPilot resolves the official asset and USDC
mint server-side and creates one durable, immutable request. The caller retains
the request ID and polls its status; retrying a write with the same idempotency
key returns that same request, while a changed intent requires a new key.
The current approval-request API still accepts requests without a client key;
require `clientRequestId` before connecting any approved request to execution,
because a timeout followed by an unkeyed retry can create a second request.

`PENDING_APPROVAL` is distinct from `PENDING_SIGNATURE`, `SUBMITTED`,
`CONFIRMED`, `REJECTED`, `FAILED` and `AMBIGUOUS`. A human decision binds the
exact asset, amount, wallet and policy version. It must not implicitly sign or
submit. A quote expiry or changed transaction needs fresh authorization. After
submission, a provider timeout is ambiguous, not permission to create a new
quote or broadcast again. Success means independently confirmed on Solana and
portfolio refreshed from chain data.

Automatic BUY requires all of the following *before* a signer call: current
user delegation, active client and OAuth grant, allowed operation and canonical
asset, exact spend/budget reservation, fresh quote and full prepared-transaction
validation (including resolved address lookup tables), idempotency claim,
revocation recheck and an operator kill switch. Privy policy is a second
barrier, not a substitute for StockPilot validation. SELL has its own distinct
asset/balance/route validation and must not inherit BUY permission.

## Release gates

- Implement and test OAuth discovery, login bridge, token validation,
  per-client revocation and tenant isolation before advertising connector setup.
- Prove manual Privy BUY with transaction validation and durable reconciliation
  on a small mainnet investment before allowing any agent execution.
- Configure delegated signing with a narrowly scoped policy and explicit user
  opt-in. Test concurrent requests, revoked grants, exhausted budgets, replay,
  malicious transaction instructions and address lookup tables.
- Make unlimited limits an explicit post-connect owner choice, never a default.
- A newly connected OAuth client receives public-market read access only. WorkOS
  identity consent alone never grants portfolio data or investment requests;
  the owner enables those separately in StockPilot Settings.
  Do not enable an automatic-trading switch until the backend can enforce it.
- Keep production agent execution disabled until these gates and a funded-wallet
  acceptance test pass. Do not claim PayBox-equivalent autonomous signing from
  OAuth alone: PayBox's documented wallet operations also have a separate
  signing-window phase.

Cards, secrets, x402 and general-purpose plugins are outside StockPilot's
investment product scope.
