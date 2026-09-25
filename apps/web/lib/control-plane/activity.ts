import "server-only";
import { controlStore, type ControlStore } from "./db";
import { ControlPlaneError, getClient, type ControlIdentity } from "./clients";

export type ActivityRecord = {
  id: string;
  eventType: string;
  actorType: "USER" | "CLIENT" | "SYSTEM";
  clientId: string | null;
  clientName: string | null;
  requestId: string | null;
  assetSymbol: string | null;
  amountUsd: string | null;
  createdAt: string;
};

export async function listActivity(identity: ControlIdentity, limit = 50, store: ControlStore = controlStore, clientId?: string): Promise<ActivityRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ControlPlaneError("INVALID_CLIENT", "Invalid activity page size.");
  }
  if (clientId !== undefined) {
    await getClient(identity, clientId, store);
  } else {
    const account = await store.query<{ primary_wallet_address: string }>(
      "SELECT primary_wallet_address FROM control_accounts WHERE id = $1", [identity.privyUserId],
    );
    if (!account.rows.length) return [];
    if (account.rows[0].primary_wallet_address !== identity.walletAddress) {
      throw new ControlPlaneError("WALLET_BINDING_MISMATCH", "Verified wallet does not match this StockPilot account.");
    }
  }
  const rows = await store.query<{
    id: string; event_type: string; actor_type: "USER" | "CLIENT" | "SYSTEM";
    client_id: string | null; client_name: string | null; request_id: string | null;
    asset_symbol: string | null; amount_usd: string | null; created_at: Date;
  }>(`SELECT e.id, e.event_type, e.actor_type, e.client_id, c.name AS client_name,
       e.request_id, r.asset_symbol, r.amount_usd, e.created_at
     FROM control_activity_events e
     LEFT JOIN control_clients c ON c.id = e.client_id AND c.account_id = e.account_id
     LEFT JOIN control_investment_requests r ON r.id = e.request_id AND r.account_id = e.account_id
     WHERE e.account_id = $1 ${clientId !== undefined ? "AND e.client_id = $3" : ""}
     ORDER BY e.created_at DESC, e.id DESC LIMIT $2`,
    clientId !== undefined ? [identity.privyUserId, limit, clientId] : [identity.privyUserId, limit]);
  return rows.rows.map((row) => ({
    id: row.id, eventType: row.event_type, actorType: row.actor_type,
    clientId: row.client_id, clientName: row.client_name, requestId: row.request_id,
    assetSymbol: row.asset_symbol, amountUsd: row.amount_usd, createdAt: row.created_at.toISOString(),
  }));
}
