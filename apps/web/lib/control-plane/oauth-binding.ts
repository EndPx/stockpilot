import "server-only";
import { randomUUID } from "node:crypto";
import { controlStore, type ControlStore } from "./db";
import type { AgentPrincipal } from "./credentials";
import type { AgentOAuthConfig } from "./oauth-config";

type OAuthIdentity = { privyUserId: string; walletAddress: string; workosUserId: string };
type OAuthClaims = { subject: string; clientId: string };

/** Called only after the browser's active Privy session and embedded wallet have been reverified. */
export async function bindOAuthSubject(identity: OAuthIdentity, config: AgentOAuthConfig, store: ControlStore = controlStore): Promise<void> {
  await store.transaction(async (db) => {
    await db.query(
      "INSERT INTO control_accounts(id, primary_wallet_address) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [identity.privyUserId, identity.walletAddress],
    );
    const account = await db.query<{ primary_wallet_address: string }>(
      "SELECT primary_wallet_address FROM control_accounts WHERE id = $1 FOR UPDATE", [identity.privyUserId],
    );
    if (account.rows[0]?.primary_wallet_address !== identity.walletAddress) throw new Error("Privy wallet binding mismatch");
    const existing = await db.query<{ account_id: string; wallet_address: string }>(
      "SELECT account_id, wallet_address FROM control_oauth_subject_bindings WHERE issuer = $1 AND subject = $2 FOR UPDATE",
      [config.issuer, identity.workosUserId],
    );
    if (existing.rows.length && (existing.rows[0].account_id !== identity.privyUserId ||
      existing.rows[0].wallet_address !== identity.walletAddress)) throw new Error("OAuth subject binding mismatch");
    await db.query(
      `INSERT INTO control_oauth_subject_bindings(issuer, subject, account_id, wallet_address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (issuer, subject) DO UPDATE SET updated_at = now()`,
      [config.issuer, identity.workosUserId, identity.privyUserId, identity.walletAddress],
    );
  });
}

/** A valid JWT alone never establishes an account: the verified Privy browser flow must have bound its subject first. */
export async function resolveOAuthPrincipal(
  claims: OAuthClaims,
  externalPrivyUserId: string,
  config: AgentOAuthConfig,
  store: ControlStore = controlStore,
): Promise<AgentPrincipal | null> {
  return store.transaction(async (db) => {
    const bindings = await db.query<{ account_id: string; wallet_address: string }>(
      `SELECT b.account_id, b.wallet_address FROM control_oauth_subject_bindings b
       JOIN control_accounts a ON a.id = b.account_id AND a.primary_wallet_address = b.wallet_address
       WHERE b.issuer = $1 AND b.subject = $2 AND b.account_id = $3 FOR UPDATE OF b`,
      [config.issuer, claims.subject, externalPrivyUserId],
    );
    const binding = bindings.rows[0];
    if (!binding) return null;

    const connection = await db.query<{ client_id: string; revoked_at: Date | null }>(
      `SELECT client_id, revoked_at FROM control_oauth_connections
       WHERE issuer = $1 AND subject = $2 AND oauth_client_id = $3 AND account_id = $4 FOR UPDATE`,
      [config.issuer, claims.subject, claims.clientId, binding.account_id],
    );
    if (connection.rows[0]?.revoked_at) return null;
    let clientId = connection.rows[0]?.client_id;
    if (!clientId) {
      clientId = randomUUID();
      const name = `OAuth ${claims.clientId.slice(0, 40)}`;
      await db.query(
        "INSERT INTO control_clients(id, account_id, name, client_type) VALUES ($1, $2, $3, 'CUSTOM')",
        [clientId, binding.account_id, name],
      );
      await db.query(
        `INSERT INTO control_grant_policies
         (client_id, scopes, max_investment_usd, daily_request_limit_usd,
          allowed_providers, allowed_market_types, buy_mode, sell_mode)
         VALUES ($1, ARRAY['markets:read'], 10, 50, ARRAY['prestocks'], ARRAY['PRE_IPO'], 'DISABLED', 'DISABLED')`,
        [clientId],
      );
      await db.query(
        `INSERT INTO control_oauth_connections(client_id, account_id, issuer, subject, oauth_client_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [clientId, binding.account_id, config.issuer, claims.subject, claims.clientId],
      );
      await db.query(
        `INSERT INTO control_activity_events(id, account_id, client_id, event_type, actor_type)
         VALUES ($1, $2, $3, 'OAUTH_CONNECTED', 'USER')`,
        [randomUUID(), binding.account_id, clientId],
      );
    }
    const rows = await db.query<{ scopes: AgentPrincipal["scopes"] }>(
      `SELECT p.scopes FROM control_clients c
       JOIN control_grant_policies p ON p.client_id = c.id
       JOIN control_oauth_connections o ON o.client_id = c.id
       WHERE c.id = $1 AND c.account_id = $2 AND c.status = 'ACTIVE' AND c.revoked_at IS NULL
         AND (c.expires_at IS NULL OR c.expires_at > now()) AND o.revoked_at IS NULL
         AND o.issuer = $3 AND o.subject = $4 AND o.oauth_client_id = $5`,
      [clientId, binding.account_id, config.issuer, claims.subject, claims.clientId],
    );
    if (!rows.rows[0]) return null;
    await db.query("UPDATE control_clients SET last_used_at = now() WHERE id = $1 AND status = 'ACTIVE'", [clientId]);
    return {
      authMethod: "oauth" as const,
      accountId: binding.account_id,
      walletAddress: binding.wallet_address,
      clientId,
      credentialId: null,
      oauthIssuer: config.issuer,
      oauthSubject: claims.subject,
      oauthClientId: claims.clientId,
      scopes: rows.rows[0].scopes,
    };
  });
}
