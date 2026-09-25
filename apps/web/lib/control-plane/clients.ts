import "server-only";
import { controlStore, type ControlQuery, type ControlStore } from "./db";

export type ControlIdentity = { privyUserId: string; walletAddress: string };
export type ClientType = "CLAUDE_CODE" | "CODEX" | "CURSOR" | "CUSTOM";
export type ClientScope = "markets:read" | "portfolio:read" | "investments:request" | "requests:read-own" | "approvals:read-own";

export type ClientRecord = {
  id: string;
  name: string;
  clientType: ClientType;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  scopes: ClientScope[];
  expiresAt: string | null;
  authMethods: ("oauth" | "api_key")[];
  oauthConnectedAt: string | null;
};

export type ClientDetailRecord = ClientRecord & {
  oauthRevokedAt: string | null;
};

type ClientDetailRow = {
  id: string; name: string; client_type: ClientType; status: ClientRecord["status"];
  created_at: Date; last_used_at: Date | null; revoked_at: Date | null; expires_at: Date | null;
  scopes: ClientScope[]; oauth_connected_at: Date | null; oauth_revoked_at: Date | null;
  has_credential: boolean; has_active_credential: boolean; has_expired_credential: boolean;
};

const clientDetailSelect = `SELECT c.id, c.name, c.client_type, c.status, c.created_at, c.last_used_at,
       c.revoked_at, c.expires_at, p.scopes,
       o.created_at AS oauth_connected_at, o.revoked_at AS oauth_revoked_at,
       EXISTS (SELECT 1 FROM control_credentials k WHERE k.client_id = c.id) AS has_credential,
       EXISTS (SELECT 1 FROM control_credentials k WHERE k.client_id = c.id
         AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())) AS has_active_credential,
       EXISTS (SELECT 1 FROM control_credentials k WHERE k.client_id = c.id
         AND k.revoked_at IS NULL AND k.expires_at <= now()) AS has_expired_credential
     FROM control_clients c
     JOIN control_accounts a ON a.id = c.account_id
     JOIN control_grant_policies p ON p.client_id = c.id
     LEFT JOIN control_oauth_connections o ON o.client_id = c.id AND o.account_id = c.account_id`;

function normalizeClientDetail(row: ClientDetailRow): ClientDetailRecord {
  const expired = row.status === "EXPIRED" || (row.expires_at !== null && row.expires_at.getTime() <= Date.now());
  const revoked = row.status === "REVOKED" || row.revoked_at !== null;
  const hasActiveOAuth = row.oauth_connected_at !== null && row.oauth_revoked_at === null;
  const status: ClientRecord["status"] = revoked ? "REVOKED" : expired ? "EXPIRED"
    : hasActiveOAuth || row.has_active_credential ? "ACTIVE"
      : row.oauth_revoked_at !== null ? "REVOKED"
        : row.has_expired_credential ? "EXPIRED" : row.has_credential ? "REVOKED" : "ACTIVE";
  return {
    id: row.id, name: row.name, clientType: row.client_type, status,
    createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null, expiresAt: row.expires_at?.toISOString() ?? null,
    scopes: row.scopes,
    authMethods: [...(row.oauth_connected_at ? ["oauth" as const] : []), ...(row.has_credential ? ["api_key" as const] : [])],
    oauthConnectedAt: row.oauth_connected_at?.toISOString() ?? null,
    oauthRevokedAt: row.oauth_revoked_at?.toISOString() ?? null,
  };
}

export class ControlPlaneError extends Error {
  constructor(readonly code: "INVALID_CLIENT" | "INVALID_POLICY" | "WALLET_BINDING_MISMATCH" | "CLIENT_NOT_FOUND" | "POLICY_NOT_FOUND", message: string) {
    super(message);
    this.name = "ControlPlaneError";
  }
}

const clientTypes = new Set<ClientType>(["CLAUDE_CODE", "CODEX", "CURSOR", "CUSTOM"]);
export const permittedScopes = new Set<ClientScope>(["markets:read", "portfolio:read", "investments:request", "requests:read-own", "approvals:read-own"]);

export function parsePositiveUsd(value: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,6})?$/.test(value) || Number(value) <= 0) {
    throw new ControlPlaneError("INVALID_CLIENT", "Enter a positive USDC limit with at most six decimals.");
  }
  return value;
}

function validateInput(input: { name: string; clientType: ClientType; scopes: ClientScope[]; maxInvestmentUsd: string; dailyRequestLimitUsd: string }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name) || !clientTypes.has(input.clientType)) {
    throw new ControlPlaneError("INVALID_CLIENT", "Client name or type is invalid.");
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0 || input.scopes.length > permittedScopes.size ||
    input.scopes.some((scope) => !permittedScopes.has(scope)) || new Set(input.scopes).size !== input.scopes.length) {
    throw new ControlPlaneError("INVALID_CLIENT", "Client permissions are invalid.");
  }
  const maxInvestmentUsd = parsePositiveUsd(input.maxInvestmentUsd);
  const dailyRequestLimitUsd = parsePositiveUsd(input.dailyRequestLimitUsd);
  if (Number(dailyRequestLimitUsd) < Number(maxInvestmentUsd)) {
    throw new ControlPlaneError("INVALID_CLIENT", "The daily request limit must cover the per-request limit.");
  }
  return { name, clientType: input.clientType, scopes: input.scopes, maxInvestmentUsd, dailyRequestLimitUsd };
}

async function ensureAccount(client: ControlQuery, identity: ControlIdentity): Promise<void> {
  if (!identity.privyUserId || !identity.walletAddress) throw new ControlPlaneError("INVALID_CLIENT", "Verified account identity is required.");
  await client.query("INSERT INTO control_accounts(id, primary_wallet_address) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [identity.privyUserId, identity.walletAddress]);
  const account = await client.query<{ primary_wallet_address: string }>(
    "SELECT primary_wallet_address FROM control_accounts WHERE id = $1 FOR UPDATE", [identity.privyUserId],
  );
  if (account.rows[0]?.primary_wallet_address !== identity.walletAddress) {
    throw new ControlPlaneError("WALLET_BINDING_MISMATCH", "This StockPilot account has a different verified wallet binding.");
  }
}

export async function createClient(input: {
  identity: ControlIdentity;
  name: string;
  clientType: ClientType;
  scopes: ClientScope[];
  maxInvestmentUsd: string;
  dailyRequestLimitUsd: string;
}, store: ControlStore = controlStore): Promise<ClientRecord> {
  const validated = validateInput(input);
  return store.transaction(async (client) => {
    await ensureAccount(client, input.identity);
    const id = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const created = await client.query<{
      created_at: Date; last_used_at: Date | null; revoked_at: Date | null;
    }>(`INSERT INTO control_clients(id, account_id, name, client_type)
      VALUES ($1, $2, $3, $4) RETURNING created_at, last_used_at, revoked_at`,
      [id, input.identity.privyUserId, validated.name, validated.clientType]);
    await client.query(`INSERT INTO control_grant_policies
      (client_id, scopes, max_investment_usd, daily_request_limit_usd, allowed_providers, allowed_market_types)
      VALUES ($1, $2, $3, $4, ARRAY['prestocks'], ARRAY['PRE_IPO'])`,
      [id, validated.scopes, validated.maxInvestmentUsd, validated.dailyRequestLimitUsd]);
    await client.query(`INSERT INTO control_activity_events
      (id, account_id, client_id, event_type, actor_type)
      VALUES ($1, $2, $3, 'CLIENT_CREATED', 'USER')`, [eventId, input.identity.privyUserId, id]);
    return {
      id,
      name: validated.name,
      clientType: validated.clientType,
      status: "ACTIVE" as const,
      createdAt: created.rows[0].created_at.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      scopes: [...validated.scopes],
      expiresAt: null,
      authMethods: [],
      oauthConnectedAt: null,
    };
  });
}

export async function listClients(identity: ControlIdentity, store: ControlStore = controlStore): Promise<ClientRecord[]> {
  const account = await store.query<{ primary_wallet_address: string }>(
    "SELECT primary_wallet_address FROM control_accounts WHERE id = $1", [identity.privyUserId],
  );
  if (!account.rows.length) return [];
  if (account.rows[0].primary_wallet_address !== identity.walletAddress) {
    throw new ControlPlaneError("WALLET_BINDING_MISMATCH", "This StockPilot account has a different verified wallet binding.");
  }
  const rows = await store.query<ClientDetailRow>(`${clientDetailSelect}
    WHERE c.account_id = $1 AND a.primary_wallet_address = $2
    ORDER BY c.created_at DESC, c.id DESC LIMIT 100`, [identity.privyUserId, identity.walletAddress]);
  return rows.rows.map(normalizeClientDetail);
}

export async function getClient(identity: ControlIdentity, clientId: string, store: ControlStore = controlStore): Promise<ClientDetailRecord> {
  if (typeof clientId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new ControlPlaneError("CLIENT_NOT_FOUND", "Client not found.");
  }
  const result = await store.query<ClientDetailRow>(`${clientDetailSelect}
     WHERE c.id = $1 AND c.account_id = $2 AND a.primary_wallet_address = $3`,
    [clientId, identity.privyUserId, identity.walletAddress]);
  const row = result.rows[0];
  if (!row) throw new ControlPlaneError("CLIENT_NOT_FOUND", "Client not found.");
  return normalizeClientDetail(row);
}

export async function revokeClient(identity: ControlIdentity, clientId: string, store: ControlStore = controlStore): Promise<void> {
  await store.transaction(async (client) => {
    await ensureAccount(client, identity);
    const result = await client.query<{ id: string }>(`UPDATE control_clients
      SET status = 'REVOKED', revoked_at = now(), updated_at = now()
      WHERE id = $1 AND account_id = $2 AND status = 'ACTIVE' RETURNING id`,
      [clientId, identity.privyUserId]);
    if (!result.rows.length) throw new ControlPlaneError("CLIENT_NOT_FOUND", "Client not found or already revoked.");
    await client.query(`UPDATE control_credentials SET revoked_at = now()
      WHERE client_id = $1 AND revoked_at IS NULL`, [clientId]);
    await client.query(`UPDATE control_oauth_connections SET revoked_at = now()
      WHERE client_id = $1 AND revoked_at IS NULL`, [clientId]);
    await client.query(`INSERT INTO control_activity_events
      (id, account_id, client_id, event_type, actor_type)
      VALUES ($1, $2, $3, 'CLIENT_REVOKED', 'USER')`, [crypto.randomUUID(), identity.privyUserId, clientId]);
  });
}
