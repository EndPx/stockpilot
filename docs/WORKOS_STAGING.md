# WorkOS Connect staging handoff

Configured on 2026-09-25 in the WorkOS **Staging** environment for StockPilot's investment-only MCP integration:

- Issuer: `https://merry-fountain-55-staging.authkit.app`
- MCP resource indicator: `https://stockpilot.endpx.cloud/api/mcp`
- Standalone Connect external sign-in URI: `https://stockpilot.endpx.cloud/api/oauth/authorize`
- Client ID Metadata Documents (CIMD) and Dynamic Client Registration (DCR): enabled
- Dedicated staging API key: `StockPilot MCP Staging rotated`, expires 2026-10-02. A predecessor key that appeared in task output was expired immediately and must not be reused.

The replacement key is only in the ignored local `apps/web/.env.workos.staging.local` file, not in Git and not in the production server environment. A read-only WorkOS users API request with it returned HTTP 200. The file is **not** loaded automatically by Next.js. Do not copy this `sk_test_` key into a production deployment.

Code for the OAuth login bridge, metadata, token verification, and owner-bound grant has been built and unit-tested locally. It has **not** been deployed or end-to-end authenticated with a real MCP host. The configured sign-in URI currently targets the production domain, so a safe Staging acceptance run needs a matching staging app deployment or an explicitly approved short-lived test arrangement; do not silently enable staging OAuth on the live financial app. WorkOS Production remains unconfigured because the dashboard requested billing information. No billing details were submitted.

Before production enablement: use a Production WorkOS environment and key, apply the Neon migrations, validate a real PKCE/CIMD client connection and revocation, and keep BUY/SELL execution disabled until the separate wallet-signing and on-chain acceptance gates in [the adaptation contract](./PAYBOX_STOCKPILOT_ADAPTATION.md) pass.
