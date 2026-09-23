import "server-only";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { controlStore, type ControlStore } from "./db";
import { ControlPlaneError, type ClientScope, type ControlIdentity } from "./clients";

const keyPattern = /^sp_live_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const credentialLifetimeDays = 90;
const dummyHash = Buffer.alloc(32);

export type IssuedCredential = {
  id: string;
  clientId: string;
  displayPrefix: string;
  expiresAt: string;
  secret: string;
};

export type AgentPrincipal = {
  accountId: string;
  walletAddress: string;
  clientId: string;
  credentialId: string;
  scopes: ClientScope[];
};

export type CredentialSummary = {
  id: string;
  clientId: string;
  clientName: string;
  displayPrefix: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export async function listCredentials(identity: ControlIdentity, store: ControlStore = controlStore): Promise<CredentialSummary[]> {
  const rows = await store.query<{
    id: string; client_id: string; client_name: string; display_prefix: string;
    status: CredentialSummary["status"]; created_at: Date; last_used_at: Date | null;
    expires_at: Date | null; revoked_at: Date | null;
  }>(`SELECT k.id, k.client_id, c.name AS client_name, k.display_prefix,
       CASE WHEN k.revoked_at IS NOT NULL OR c.status = 'REVOKED' THEN 'REVOKED'
            WHEN k.expires_at <= now() OR c.expires_at <= now() OR c.status = 'EXPIRED' THEN 'EXPIRED'
            ELSE 'ACTIVE' END AS status,
       k.created_at, k.last_used_at, k.expires_at, k.revoked_at
     FROM control_credentials k JOIN control_clients c ON c.id = k.client_id
     JOIN control_accounts a ON a.id = c.account_id
     WHERE c.account_id = $1 AND a.primary_wallet_address = $2
     ORDER BY k.created_at DESC, k.id DESC LIMIT 100`, [identity.privyUserId, identity.walletAddress]);
  return rows.rows.map((row) => ({
    id: row.id, clientId: row.client_id, clientName: row.client_name,
    displayPrefix: row.display_prefix, status: row.status,
    createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null, revokedAt: row.revoked_at?.toISOString() ?? null,
  }));
}

function getPepper(): Buffer {
  const pepper = process.env.CONTROL_PLANE_KEY_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, "utf8") < 32) {
    throw new Error("Control-plane credential verification is not configured");
  }
  return Buffer.from(pepper, "utf8");
}

function hashSecret(secret: string): Buffer {
  return createHmac("sha256", getPepper()).update(secret).digest();
}

async function insertCredential(clientId: string, store: ControlStore, rotated: boolean, identity: ControlIdentity): Promise<IssuedCredential> {
  return store.transaction(async (db) => {
    const owner = await db.query<{ id: string; primary_wallet_address: string }>(
      `SELECT c.id, a.primary_wallet_address FROM control_clients c
       JOIN control_accounts a ON a.id = c.account_id
       WHERE c.id = $1 AND c.account_id = $2 AND c.status = 'ACTIVE'
         AND (c.expires_at IS NULL OR c.expires_at > now()) FOR UPDATE OF c`,
      [clientId, identity.privyUserId],
    );
    if (!owner.rows.length || owner.rows[0].primary_wallet_address !== identity.walletAddress) {
      throw new ControlPlaneError("CLIENT_NOT_FOUND", "Active client not found for this account.");
    }
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM control_credentials WHERE client_id = $1 AND revoked_at IS NULL FOR UPDATE", [clientId],
    );
    if (existing.rows.length && !rotated) {
      throw new ControlPlaneError("INVALID_CLIENT", "This client already has an active credential. Rotate it instead.");
    }
    if (!existing.rows.length && rotated) {
      throw new ControlPlaneError("INVALID_CLIENT", "This client has no active credential to rotate.");
    }
    if (rotated) {
      await db.query("UPDATE control_credentials SET revoked_at = now() WHERE client_id = $1 AND revoked_at IS NULL", [clientId]);
    }
    const id = randomUUID();
    const secret = `sp_live_${id.replaceAll("-", "")}_${randomBytes(32).toString("base64url")}`;
    const displayPrefix = `sp_live_${id.slice(0, 8)}`;
    const result = await db.query<{ expires_at: Date }>(
      `INSERT INTO control_credentials(id, client_id, display_prefix, secret_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5::integer * interval '1 day')) RETURNING expires_at`,
      [id, clientId, displayPrefix, hashSecret(secret), credentialLifetimeDays],
    );
    await db.query(
      `INSERT INTO control_activity_events(id, account_id, client_id, event_type, actor_type)
       VALUES ($1, $2, $3, $4, 'USER')`,
      [randomUUID(), identity.privyUserId, clientId, rotated ? "CREDENTIAL_ROTATED" : "CREDENTIAL_CREATED"],
    );
    return { id, clientId, displayPrefix, expiresAt: result.rows[0].expires_at.toISOString(), secret };
  });
}

export function issueCredential(identity: ControlIdentity, clientId: string, store: ControlStore = controlStore): Promise<IssuedCredential> {
  getPepper();
  return insertCredential(clientId, store, false, identity);
}

export function rotateCredential(identity: ControlIdentity, clientId: string, store: ControlStore = controlStore): Promise<IssuedCredential> {
  getPepper();
  return insertCredential(clientId, store, true, identity);
}

export async function revokeCredential(identity: ControlIdentity, clientId: string, store: ControlStore = controlStore): Promise<void> {
  await store.transaction(async (db) => {
    const result = await db.query<{ id: string }>(
      `UPDATE control_credentials k SET revoked_at = now()
       FROM control_clients c JOIN control_accounts a ON a.id = c.account_id
       WHERE k.client_id = c.id AND c.id = $1 AND c.account_id = $2
         AND a.primary_wallet_address = $3 AND k.revoked_at IS NULL RETURNING k.id`,
      [clientId, identity.privyUserId, identity.walletAddress],
    );
    if (!result.rows.length) throw new ControlPlaneError("CLIENT_NOT_FOUND", "Active credential not found for this account.");
    await db.query(
      `INSERT INTO control_activity_events(id, account_id, client_id, event_type, actor_type)
       VALUES ($1, $2, $3, 'CREDENTIAL_REVOKED', 'USER')`,
      [randomUUID(), identity.privyUserId, clientId],
    );
  });
}

export async function verifyCredential(secret: string, store: ControlStore = controlStore): Promise<AgentPrincipal | null> {
  const pepper = getPepper();
  const parsed = typeof secret === "string" && secret.length < 160 ? keyPattern.exec(secret) : null;
  if (!parsed) return null;
  const id = `${parsed[1].slice(0, 8)}-${parsed[1].slice(8, 12)}-${parsed[1].slice(12, 16)}-${parsed[1].slice(16, 20)}-${parsed[1].slice(20)}`;
  const row = await store.query<{
    account_id: string; primary_wallet_address: string; client_id: string;
    secret_hash: Uint8Array; scopes: ClientScope[];
  }>(`SELECT c.account_id, a.primary_wallet_address, c.id AS client_id, k.secret_hash, p.scopes
      FROM control_credentials k JOIN control_clients c ON c.id = k.client_id
      JOIN control_accounts a ON a.id = c.account_id
      JOIN control_grant_policies p ON p.client_id = c.id
      WHERE k.id = $1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
        AND c.status = 'ACTIVE' AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())`, [id]);
  const calculated = createHmac("sha256", pepper).update(secret).digest();
  const stored = row.rows[0]?.secret_hash ? Buffer.from(row.rows[0].secret_hash) : dummyHash;
  const valid = stored.length === 32 && timingSafeEqual(calculated, stored);
  if (!valid || !row.rows[0]) return null;
  await store.query("UPDATE control_credentials SET last_used_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
  await store.query("UPDATE control_clients SET last_used_at = now() WHERE id = $1 AND status = 'ACTIVE'", [row.rows[0].client_id]);
  return {
    accountId: row.rows[0].account_id,
    walletAddress: row.rows[0].primary_wallet_address,
    clientId: row.rows[0].client_id,
    credentialId: id,
    scopes: row.rows[0].scopes,
  };
}
