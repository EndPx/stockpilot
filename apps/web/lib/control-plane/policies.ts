import "server-only";
import { controlStore, type ControlStore } from "./db";
import { ControlPlaneError, parsePositiveUsd, permittedScopes, type ClientScope, type ControlIdentity } from "./clients";

export type GrantPolicy = {
  clientId: string;
  approvalMode: "ALWAYS_APPROVE";
  scopes: ClientScope[];
  buyMode: "DISABLED" | "APPROVAL" | "AUTO";
  sellMode: "DISABLED" | "APPROVAL" | "AUTO";
  maxInvestmentUsd: string | null;
  dailyRequestLimitUsd: string | null;
  allowedProviders: ["prestocks"];
  allowedMarketTypes: ["PRE_IPO"];
  version: number;
  updatedAt: string;
};

type PolicyRow = {
  client_id: string; approval_mode: "ALWAYS_APPROVE"; scopes: ClientScope[];
  buy_mode: GrantPolicy["buyMode"]; sell_mode: GrantPolicy["sellMode"];
  max_investment_usd: string | null; daily_request_limit_usd: string | null;
  allowed_providers: ["prestocks"]; allowed_market_types: ["PRE_IPO"];
  version: number; updated_at: Date;
};

function normalize(row: PolicyRow): GrantPolicy {
  return {
    clientId: row.client_id, approvalMode: row.approval_mode, scopes: row.scopes,
    buyMode: row.buy_mode, sellMode: row.sell_mode,
    maxInvestmentUsd: row.max_investment_usd, dailyRequestLimitUsd: row.daily_request_limit_usd,
    allowedProviders: row.allowed_providers, allowedMarketTypes: row.allowed_market_types,
    version: row.version, updatedAt: row.updated_at.toISOString(),
  };
}

export async function getPolicy(identity: ControlIdentity, clientId: string, store: ControlStore = controlStore): Promise<GrantPolicy> {
  const result = await store.query<PolicyRow>(
    `SELECT p.* FROM control_grant_policies p JOIN control_clients c ON c.id = p.client_id
     JOIN control_accounts a ON a.id = c.account_id
     WHERE c.id = $1 AND c.account_id = $2 AND a.primary_wallet_address = $3`,
    [clientId, identity.privyUserId, identity.walletAddress],
  );
  if (!result.rows.length) throw new ControlPlaneError("POLICY_NOT_FOUND", "Client policy not found.");
  return normalize(result.rows[0]);
}

export async function updatePolicy(identity: ControlIdentity, clientId: string, input: {
  scopes: ClientScope[];
  buyMode?: GrantPolicy["buyMode"];
  sellMode?: GrantPolicy["sellMode"];
  maxInvestmentUsd: string | null;
  dailyRequestLimitUsd: string | null;
  expectedVersion: number;
}, store: ControlStore = controlStore): Promise<GrantPolicy> {
  if (!Array.isArray(input.scopes) || input.scopes.length < 1 || input.scopes.length > permittedScopes.size ||
      input.scopes.some((scope) => !permittedScopes.has(scope)) || new Set(input.scopes).size !== input.scopes.length ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ControlPlaneError("INVALID_POLICY", "Policy permissions or version are invalid.");
  }
  const buyMode = input.buyMode ?? (input.scopes.includes("investments:request") ? "APPROVAL" : "DISABLED");
  const sellMode = input.sellMode ?? "DISABLED";
  if (!["DISABLED", "APPROVAL", "AUTO"].includes(buyMode) ||
      !["DISABLED", "APPROVAL", "AUTO"].includes(sellMode)) {
    throw new ControlPlaneError("INVALID_POLICY", "Trading permissions are invalid.");
  }
  if (buyMode === "AUTO" || sellMode !== "DISABLED") {
    throw new ControlPlaneError("INVALID_POLICY", "Automatic trading and selling are not available yet.");
  }
  if ((buyMode === "APPROVAL") !== input.scopes.includes("investments:request")) {
    throw new ControlPlaneError("INVALID_POLICY", "BUY request permission and approval mode must agree.");
  }
  const maxInvestmentUsd = input.maxInvestmentUsd === null ? null : parsePositiveUsd(input.maxInvestmentUsd);
  const dailyRequestLimitUsd = input.dailyRequestLimitUsd === null ? null : parsePositiveUsd(input.dailyRequestLimitUsd);
  if (maxInvestmentUsd !== null && dailyRequestLimitUsd !== null && Number(dailyRequestLimitUsd) < Number(maxInvestmentUsd)) {
    throw new ControlPlaneError("INVALID_POLICY", "Daily request limit must cover the per-request limit.");
  }
  return store.transaction(async (db) => {
    const result = await db.query<PolicyRow>(
      `UPDATE control_grant_policies p SET scopes = $4, max_investment_usd = $5,
         daily_request_limit_usd = $6, buy_mode = $8, sell_mode = $9,
         version = p.version + 1, updated_at = now()
       FROM control_clients c JOIN control_accounts a ON a.id = c.account_id
       WHERE p.client_id = c.id AND c.id = $1 AND c.account_id = $2
         AND a.primary_wallet_address = $3 AND c.status = 'ACTIVE'
         AND p.version = $7 RETURNING p.*`,
      [clientId, identity.privyUserId, identity.walletAddress, input.scopes, maxInvestmentUsd, dailyRequestLimitUsd,
        input.expectedVersion, buyMode, sellMode],
    );
    if (!result.rows.length) throw new ControlPlaneError("POLICY_NOT_FOUND", "Active client policy not found or was changed. Refresh and retry.");
    await db.query(
      `INSERT INTO control_activity_events(id, account_id, client_id, event_type, actor_type, details)
       VALUES ($1, $2, $3, 'POLICY_UPDATED', 'USER', $4::jsonb)`,
      [crypto.randomUUID(), identity.privyUserId, clientId, JSON.stringify({ version: result.rows[0].version })],
    );
    return normalize(result.rows[0]);
  });
}
