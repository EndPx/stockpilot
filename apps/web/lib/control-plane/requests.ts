import "server-only";
import { randomUUID } from "node:crypto";
import { parseUsdcAmount } from "@stockpilot/core/investments";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { assertAssetIdentity, type InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import { marketRegistry } from "@/lib/markets";
import { controlStore, type ControlQuery, type ControlStore } from "./db";
import type { AgentPrincipal } from "./credentials";

export type RequestStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "BLOCKED";
export type InvestmentRequestRecord = {
  id: string;
  clientId: string;
  assetId: string;
  assetName: string;
  assetSymbol: string;
  provider: "prestocks";
  marketType: "PRE_IPO";
  canonicalMint: string;
  fundingMint: string;
  amountUsd: string;
  clientRequestId: string | null;
  policyVersion: number;
  policyMaxInvestmentUsd: string | null;
  status: RequestStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
};

export type RequestRow = {
  id: string; client_id: string; asset_id: string; asset_name: string; asset_symbol: string;
  provider: "prestocks"; market_type: "PRE_IPO"; canonical_mint: string; funding_mint: string;
  amount_usd: string; policy_version: number; policy_max_investment_usd: string | null;
  client_request_id: string | null;
  status: RequestStatus; created_at: Date; expires_at: Date; decided_at: Date | null;
};

export class RequestError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "ASSET_UNAVAILABLE" | "CLIENT_NOT_ALLOWED" | "POLICY_LIMIT" | "REQUEST_NOT_FOUND" | "IDEMPOTENCY_CONFLICT", message: string) {
    super(message);
    this.name = "RequestError";
  }
}

export function normalizeRequest(row: RequestRow): InvestmentRequestRecord {
  return {
    id: row.id, clientId: row.client_id, assetId: row.asset_id,
    assetName: row.asset_name, assetSymbol: row.asset_symbol,
    provider: row.provider, marketType: row.market_type, canonicalMint: row.canonical_mint,
    fundingMint: row.funding_mint, amountUsd: row.amount_usd, clientRequestId: row.client_request_id,
    policyVersion: row.policy_version, policyMaxInvestmentUsd: row.policy_max_investment_usd,
    status: row.status, createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(), decidedAt: row.decided_at?.toISOString() ?? null,
  };
}

function principalAuthParams(principal: AgentPrincipal): [string | null, string | null, string | null, string | null, AgentPrincipal["authMethod"]] {
  return principal.authMethod === "api_key"
    ? [principal.credentialId, null, null, null, "api_key"]
    : [null, principal.oauthIssuer, principal.oauthSubject, principal.oauthClientId, "oauth"];
}

export async function expirePendingRequests(db: ControlQuery, accountId: string, clientId?: string): Promise<void> {
  const expired = await db.query<{ id: string; client_id: string }>(
    `UPDATE control_investment_requests
     SET status = 'EXPIRED', decided_at = now()
     WHERE account_id = $1 AND ($2::uuid IS NULL OR client_id = $2)
       AND status = 'PENDING_APPROVAL' AND expires_at <= now()
     RETURNING id, client_id`, [accountId, clientId ?? null],
  );
  for (const row of expired.rows) {
    await db.query(
      `INSERT INTO control_activity_events(id, account_id, client_id, request_id, event_type, actor_type)
       VALUES ($1, $2, $3, $4, 'APPROVAL_EXPIRED', 'SYSTEM')`,
      [randomUUID(), accountId, row.client_id, row.id],
    );
  }
}

export async function getClientRequest(principal: AgentPrincipal, requestId: string, store: ControlStore = controlStore): Promise<InvestmentRequestRecord> {
  if (!principal.scopes.includes("requests:read-own")) throw new RequestError("REQUEST_NOT_FOUND", "Request not found.");
  if (!/^[0-9a-f-]{36}$/.test(requestId)) throw new RequestError("REQUEST_NOT_FOUND", "Request not found.");
  return store.transaction(async (db) => {
    await expirePendingRequests(db, principal.accountId, principal.clientId);
    const result = await db.query<RequestRow>(
      `SELECT r.* FROM control_investment_requests r
       JOIN control_clients c ON c.id = r.client_id
       JOIN control_grant_policies p ON p.client_id = c.id
       JOIN control_accounts a ON a.id = c.account_id
       LEFT JOIN control_credentials k ON k.client_id = c.id AND k.id = $4::uuid
       LEFT JOIN control_oauth_connections o ON o.client_id = c.id AND o.account_id = c.account_id
         AND o.issuer = $5 AND o.subject = $6 AND o.oauth_client_id = $7
       WHERE r.id = $1 AND r.account_id = $2 AND r.client_id = $3
         AND a.primary_wallet_address = $9
         AND (($8 = 'api_key' AND k.id IS NOT NULL AND k.revoked_at IS NULL
               AND (k.expires_at IS NULL OR k.expires_at > now()))
           OR ($8 = 'oauth' AND o.client_id IS NOT NULL AND o.revoked_at IS NULL))
         AND c.status = 'ACTIVE' AND c.revoked_at IS NULL
         AND (c.expires_at IS NULL OR c.expires_at > now())
         AND 'requests:read-own' = ANY(p.scopes)`,
      [requestId, principal.accountId, principal.clientId, ...principalAuthParams(principal), principal.walletAddress],
    );
    if (!result.rows.length) throw new RequestError("REQUEST_NOT_FOUND", "Request not found.");
    return normalizeRequest(result.rows[0]);
  });
}

export async function listClientRequests(principal: AgentPrincipal, limit = 25, before?: string, store: ControlStore = controlStore): Promise<{
  requests: InvestmentRequestRecord[]; nextCursor: string | null;
}> {
  if (!principal.scopes.includes("requests:read-own")) throw new RequestError("CLIENT_NOT_ALLOWED", "Client is not permitted to read requests.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RequestError("INVALID_INPUT", "Invalid page size.");
  let cursor: { createdAt: string; id: string } | null = null;
  if (before) {
    try {
      if (before.length > 300 || !/^[A-Za-z0-9_-]+$/.test(before)) throw new Error();
      const parsed = JSON.parse(Buffer.from(before, "base64url").toString("utf8"));
      if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt)) ||
          typeof parsed.id !== "string" || !/^[0-9a-f-]{36}$/.test(parsed.id)) throw new Error();
      cursor = parsed;
    } catch { throw new RequestError("INVALID_INPUT", "Invalid request cursor."); }
  }
  return store.transaction(async (db) => {
    await expirePendingRequests(db, principal.accountId, principal.clientId);
    const rows = await db.query<RequestRow>(
      `SELECT r.* FROM control_investment_requests r
       JOIN control_clients c ON c.id = r.client_id
       JOIN control_grant_policies p ON p.client_id = c.id
       JOIN control_accounts a ON a.id = c.account_id
       LEFT JOIN control_credentials k ON k.client_id = c.id AND k.id = $3::uuid
       LEFT JOIN control_oauth_connections o ON o.client_id = c.id AND o.account_id = c.account_id
         AND o.issuer = $4 AND o.subject = $5 AND o.oauth_client_id = $6
       WHERE r.account_id = $1 AND r.client_id = $2 AND a.primary_wallet_address = $8
         AND (($7 = 'api_key' AND k.id IS NOT NULL AND k.revoked_at IS NULL
               AND (k.expires_at IS NULL OR k.expires_at > now()))
           OR ($7 = 'oauth' AND o.client_id IS NOT NULL AND o.revoked_at IS NULL))
         AND c.status = 'ACTIVE' AND c.revoked_at IS NULL
         AND (c.expires_at IS NULL OR c.expires_at > now())
         AND 'requests:read-own' = ANY(p.scopes)
         AND ($9::timestamptz IS NULL OR (r.created_at, r.id) < ($9::timestamptz, $10::uuid))
       ORDER BY r.created_at DESC, r.id DESC LIMIT $11`,
      [principal.accountId, principal.clientId, ...principalAuthParams(principal), principal.walletAddress,
        cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const page = rows.rows.slice(0, limit);
    const last = page.at(-1);
    return {
      requests: page.map(normalizeRequest),
      nextCursor: rows.rows.length > limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.created_at.toISOString(), id: last.id })).toString("base64url")
        : null,
    };
  });
}

export type AssetResolver = (assetId: string) => Promise<{ asset: InvestmentAsset | null; stale: boolean }>;

const resolveCanonicalPreStock: AssetResolver = async (assetId) => {
  const snapshot = await marketRegistry.getSnapshot("prestocks");
  return { asset: snapshot.assets.find((asset) => asset.id === assetId) ?? null, stale: snapshot.stale };
};

function amountMicros(value: string): bigint {
  try {
    const parsed = parseUsdcAmount(value);
    if (parsed.amountUsd.length > 16) throw new Error();
    return BigInt(parsed.amountRaw);
  } catch {
    throw new RequestError("INVALID_INPUT", "Enter a positive USDC amount with at most six decimals.");
  }
}

export async function createInvestmentRequest(
  principal: AgentPrincipal,
  input: { assetId: string; amountUsd: string; clientRequestId: string },
  store: ControlStore = controlStore,
  resolveAsset: AssetResolver = resolveCanonicalPreStock,
): Promise<InvestmentRequestRecord> {
  if (!input || typeof input.assetId !== "string" || !/^prestocks:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.assetId) ||
      typeof input.amountUsd !== "string" ||
      typeof input.clientRequestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(input.clientRequestId)) {
    throw new RequestError("INVALID_INPUT", "A canonical PreStocks assetId, amountUsd and clientRequestId are required.");
  }
  if (!principal.scopes.includes("investments:request")) {
    throw new RequestError("CLIENT_NOT_ALLOWED", "Client is not permitted to request this investment.");
  }
  const requestedMicros = amountMicros(input.amountUsd);
  const resolved = await resolveAsset(input.assetId);
  const asset = resolved.asset;
  if (resolved.stale || !asset || asset.id !== input.assetId || asset.provider !== "prestocks" || asset.marketType !== "PRE_IPO") {
    throw new RequestError("ASSET_UNAVAILABLE", "Official PreStocks asset is unavailable or its catalog is stale.");
  }
  assertAssetIdentity(asset);
  if (asset.name.length > 200 || asset.symbol.length > 50) {
    throw new RequestError("ASSET_UNAVAILABLE", "Official asset metadata is outside supported limits.");
  }
  return store.transaction(async (db) => {
    // Lock the policy row to serialize this client's daily request accounting.
    const policy = await db.query<{
      scopes: string[]; buy_mode: string;
      max_investment_usd: string | null; daily_request_limit_usd: string | null;
      allowed_providers: string[]; allowed_market_types: string[]; version: number;
    }>(`SELECT p.scopes, p.buy_mode, p.max_investment_usd, p.daily_request_limit_usd,
          p.allowed_providers, p.allowed_market_types, p.version
        FROM control_grant_policies p JOIN control_clients c ON c.id = p.client_id
        JOIN control_accounts a ON a.id = c.account_id
        LEFT JOIN control_credentials k ON k.client_id = c.id AND k.id = $4::uuid
        LEFT JOIN control_oauth_connections o ON o.client_id = c.id AND o.account_id = c.account_id
          AND o.issuer = $5 AND o.subject = $6 AND o.oauth_client_id = $7
        WHERE c.id = $1 AND c.account_id = $2 AND a.primary_wallet_address = $3
          AND (($8 = 'api_key' AND k.id IS NOT NULL AND k.revoked_at IS NULL
                AND (k.expires_at IS NULL OR k.expires_at > now()))
            OR ($8 = 'oauth' AND o.client_id IS NOT NULL AND o.revoked_at IS NULL))
          AND c.status = 'ACTIVE' AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())
        FOR UPDATE OF p, c`,
      [principal.clientId, principal.accountId, principal.walletAddress, ...principalAuthParams(principal)],
    );
    const grant = policy.rows[0];
    if (!grant || grant.buy_mode !== "APPROVAL" || !grant.scopes.includes("investments:request") ||
        !grant.allowed_providers.includes(asset.provider) || !grant.allowed_market_types.includes(asset.marketType)) {
      throw new RequestError("CLIENT_NOT_ALLOWED", "Client is not permitted to request this investment.");
    }
    const prior = await db.query<RequestRow>(
      `SELECT * FROM control_investment_requests
       WHERE client_id = $1 AND client_request_id = $2`,
      [principal.clientId, input.clientRequestId],
    );
    if (prior.rows.length) {
      const existing = prior.rows[0];
      if (existing.asset_id !== input.assetId || amountMicros(existing.amount_usd) !== requestedMicros) {
        throw new RequestError("IDEMPOTENCY_CONFLICT", "This clientRequestId was used for a different investment intent.");
      }
      return normalizeRequest(existing);
    }
    if (grant.max_investment_usd !== null && requestedMicros > amountMicros(grant.max_investment_usd)) {
      throw new RequestError("POLICY_LIMIT", "Amount exceeds the client's per-request limit.");
    }
    if (grant.daily_request_limit_usd !== null) {
      const daily = await db.query<{ total_usd: string }>(
        `SELECT COALESCE(SUM(amount_usd), 0)::text AS total_usd
         FROM control_investment_requests WHERE client_id = $1 AND created_at > now() - interval '24 hours'`,
        [principal.clientId],
      );
      const usedMicros = daily.rows[0].total_usd === "0" ? 0n : amountMicros(daily.rows[0].total_usd);
      if (usedMicros + requestedMicros > amountMicros(grant.daily_request_limit_usd)) {
        throw new RequestError("POLICY_LIMIT", "Client's 24-hour requested amount limit was reached.");
      }
    }
    const id = randomUUID();
    const result = await db.query<RequestRow>(
      `INSERT INTO control_investment_requests
        (id, account_id, client_id, asset_id, asset_name, asset_symbol, provider, market_type,
         canonical_mint, funding_mint, amount_usd, client_request_id, policy_version, policy_max_investment_usd, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'prestocks', 'PRE_IPO', $7, $8, $9, $10, $11, $12,
               now() + interval '15 minutes') RETURNING *`,
      [id, principal.accountId, principal.clientId, asset.id, asset.name, asset.symbol,
        asset.mintAddress, SOLANA_MAINNET_USDC_MINT, input.amountUsd, input.clientRequestId,
        grant.version, grant.max_investment_usd],
    );
    await db.query(
      `INSERT INTO control_activity_events(id, account_id, client_id, request_id, event_type, actor_type)
       VALUES ($1, $2, $3, $4, 'INVESTMENT_REQUESTED', 'CLIENT')`,
      [randomUUID(), principal.accountId, principal.clientId, id],
    );
    return normalizeRequest(result.rows[0]);
  });
}
