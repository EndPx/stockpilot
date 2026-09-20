# Wallet authentication architecture

StockPilot authentication proves control of a connected Solana wallet without
granting transaction authority. The global Solana client continues to use
`walletWithoutSigner`; authentication calls only the Wallet Standard
`solana:signIn` or, when that feature is unavailable, `solana:signMessage`.

## Protocol

1. The browser posts the connected wallet address to `/api/auth/challenge`.
2. The server validates the request origin and returns a Sign In With Solana
   input containing the configured domain and URI, `solana:mainnet`, a random
   nonce, issue and expiry timestamps, a request identifier, and a statement
   that the signature cannot authorize transactions or transfers.
3. The authoritative challenge is also stored in an HMAC-signed, HttpOnly cookie
   that expires after five minutes. No nonce registry or process memory is used,
   so a server restart does not invalidate an otherwise valid challenge and all
   instances can verify it with the same secret.
4. The wallet signs through `solana:signIn` when supported. A wallet that exposes
   only `solana:signMessage` signs the canonical SIWS message generated from the
   same server input. Both paths are verified by the maintained Wallet Standard
   SIWS verifier against the server-held input.
5. `/api/auth/verify` consumes the challenge cookie on every attempt. It checks
   the signed payload, signature, wallet, nonce, request identifier, domain,
   URI, chain, statement, and validity window before issuing a wallet-bound,
   HMAC-signed session cookie that expires after 24 hours.
6. `/api/auth/session` restores a valid session. `/api/auth/logout` validates the
   origin and expires both authentication cookies.

## Cookie and origin policy

- Cookies are `HttpOnly`, `SameSite=Lax`, and scoped to the narrowest useful
  path (`/api/auth` for a challenge and `/` for a session).
- Cookies are `Secure` whenever `APP_URL` uses HTTPS or the app runs in
  production.
- Mutating authentication routes accept only same-origin requests according to
  the centralized `APP_URL` value.
- Tokens are versioned, encoded as base64url JSON, and authenticated with
  HMAC-SHA-256 using `SESSION_SECRET`. Values are never accepted without a valid
  signature and expected token kind.

## Replay and wallet switching

The challenge is single-use in a browser session because verification clears its
HttpOnly cookie before returning, including on failed verification. A repeated
verification therefore fails with `AUTH_REPLAY_DETECTED`; retrying requires a
fresh challenge. Session state is always compared with the currently connected
wallet. Switching from wallet A to wallet B clears A's session, while a page
reload never presents a session as a connected wallet until that same wallet has
reconnected.

## Configuration

- `APP_URL`: canonical deployment origin, for example `http://localhost:3000`.
- `SESSION_SECRET`: a deployment secret with at least 32 bytes of entropy. It
  must be identical across application instances and must not be committed.

Markets, asset details, and public asset APIs remain available without a wallet
or authenticated session.

References:

- SIWS specification and compatibility flow: https://github.com/phantom/sign-in-with-solana
- Wallet Standard Solana features: https://github.com/wallet-standard/wallet-standard/blob/master/extensions/solana.md
