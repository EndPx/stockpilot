# WorkOS Connect staging handoff

Configured on 2026-09-25 in the WorkOS **Staging** environment for StockPilot's investment-only MCP integration:

- Issuer: `https://merry-fountain-55-staging.authkit.app`
- MCP resource indicator: `https://stockpilot.endpx.cloud/api/mcp`
- Standalone Connect external sign-in URI: `https://stockpilot.endpx.cloud/api/oauth/authorize`
- Client ID Metadata Documents (CIMD) and Dynamic Client Registration (DCR): enabled
- Dedicated staging API key: `StockPilot MCP Staging rotated`, expires 2026-10-02. A predecessor key that appeared in task output was expired immediately and must not be reused.

The replacement key is kept out of Git. For the user-approved hackathon demo, it was installed as a root-only runtime secret on the existing StockPilot VPS, and Staging OAuth was enabled on the main site in release `179d7d6`. Public discovery and unauthenticated rejection passed smoke tests. This is a temporary exception, **not** Production WorkOS readiness. The key expires on 2026-10-02; rotate or disable OAuth before then. WorkOS Production remains unconfigured because the dashboard requested billing information. No billing details were submitted.

During initial live OAuth acceptance, WorkOS created a user but StockPilot returned `OAUTH_LOGIN_UNAVAILABLE`. The separate Neon `stockpilot_app` runtime role lacked privileges on the two new OAuth tables and lacked the column-level `UPDATE` privilege needed to lock `control_accounts` with `SELECT ... FOR UPDATE`. The owner granted only `SELECT`, `INSERT`, and `UPDATE` on the two OAuth tables plus `UPDATE (updated_at)` on `control_accounts`; `DELETE` and wallet-address updates remain denied. A rollback-only probe using the actual runtime role now completes the binding queries. Keep `deploy/grant-runtime-oauth.sql` in the rollout for a fresh database. A new OAuth attempt, not a refresh of an already-used `external_auth_id`, is required to confirm end-to-end connection.

Before permanent production enablement: use a Production WorkOS environment and key, apply the Neon migrations and runtime grants, validate a real PKCE/CIMD client connection and revocation, and keep BUY/SELL execution disabled until the separate wallet-signing and on-chain acceptance gates in [the adaptation contract](./PAYBOX_STOCKPILOT_ADAPTATION.md) pass.
