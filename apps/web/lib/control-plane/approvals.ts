import "server-only";
import { randomUUID } from "node:crypto";
import { controlStore, type ControlStore } from "./db";
import { ControlPlaneError, type ControlIdentity } from "./clients";
import { expirePendingRequests, normalizeRequest, type InvestmentRequestRecord, type RequestRow, type RequestStatus } from "./requests";

export type OwnerRequest = InvestmentRequestRecord & { clientName: string };
export class ApprovalError extends Error {
  constructor(readonly code: "REQUEST_NOT_FOUND" | "REQUEST_NOT_PENDING" | "INVALID_FILTER", message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

async function assertOwnerWallet(store: ControlStore, identity: ControlIdentity): Promise<void> {
  const account = await store.query<{ primary_wallet_address: string }>(
    "SELECT primary_wallet_address FROM control_accounts WHERE id = $1", [identity.privyUserId],
  );
  if (!account.rows.length || account.rows[0].primary_wallet_address !== identity.walletAddress) {
    throw new ControlPlaneError("WALLET_BINDING_MISMATCH", "Verified wallet does not match this StockPilot account.");
  }
}

export async function listOwnerRequests(identity: ControlIdentity, status: RequestStatus | "ALL" = "ALL", limit = 50,
  store: ControlStore = controlStore): Promise<OwnerRequest[]> {
  if (!["ALL", "PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "BLOCKED"].includes(status) ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApprovalError("INVALID_FILTER", "Invalid approval filter.");
  await assertOwnerWallet(store, identity);
  return store.transaction(async (db) => {
    await expirePendingRequests(db, identity.privyUserId);
    const rows = await db.query<RequestRow & { client_name: string }>(
      `SELECT r.*, c.name AS client_name FROM control_investment_requests r
       JOIN control_clients c ON c.id = r.client_id
       WHERE r.account_id = $1 AND ($2::text = 'ALL' OR r.status = $2)
       ORDER BY r.created_at DESC, r.id DESC LIMIT $3`,
      [identity.privyUserId, status, limit],
    );
    return rows.rows.map((row) => ({ ...normalizeRequest(row), clientName: row.client_name }));
  });
}

export async function getOwnerRequest(identity: ControlIdentity, requestId: string,
  store: ControlStore = controlStore): Promise<OwnerRequest> {
  if (!/^[0-9a-f-]{36}$/.test(requestId)) throw new ApprovalError("REQUEST_NOT_FOUND", "Request not found.");
  await assertOwnerWallet(store, identity);
  return store.transaction(async (db) => {
    await expirePendingRequests(db, identity.privyUserId);
    const result = await db.query<RequestRow & { client_name: string }>(
      `SELECT r.*, c.name AS client_name FROM control_investment_requests r
       JOIN control_clients c ON c.id = r.client_id
       WHERE r.id = $1 AND r.account_id = $2`, [requestId, identity.privyUserId],
    );
    if (!result.rows.length) throw new ApprovalError("REQUEST_NOT_FOUND", "Request not found.");
    return { ...normalizeRequest(result.rows[0]), clientName: result.rows[0].client_name };
  });
}

export async function decideRequest(identity: ControlIdentity, requestId: string, decision: "APPROVED" | "REJECTED",
  store: ControlStore = controlStore): Promise<OwnerRequest> {
  if (!/^[0-9a-f-]{36}$/.test(requestId) || !["APPROVED", "REJECTED"].includes(decision)) {
    throw new ApprovalError("REQUEST_NOT_FOUND", "Request not found.");
  }
  await assertOwnerWallet(store, identity);
  // Expiry must commit even when the following decision is rejected.
  await store.transaction((db) => expirePendingRequests(db, identity.privyUserId));
  return store.transaction(async (db) => {
    const result = await db.query<RequestRow & { client_name: string }>(
      `UPDATE control_investment_requests r SET status = $3, decided_at = now()
       FROM control_clients c WHERE r.id = $1 AND r.account_id = $2
         AND r.client_id = c.id AND r.status = 'PENDING_APPROVAL' AND r.expires_at > now()
       RETURNING r.*, c.name AS client_name`, [requestId, identity.privyUserId, decision],
    );
    if (!result.rows.length) throw new ApprovalError("REQUEST_NOT_PENDING", "Request is not pending or has expired.");
    await db.query(
      "INSERT INTO control_approvals(request_id, account_id, decision) VALUES ($1, $2, $3)",
      [requestId, identity.privyUserId, decision],
    );
    await db.query(
      `INSERT INTO control_activity_events(id, account_id, client_id, request_id, event_type, actor_type)
       VALUES ($1, $2, $3, $4, $5, 'USER')`,
      [randomUUID(), identity.privyUserId, result.rows[0].client_id, requestId,
        decision === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED"],
    );
    return { ...normalizeRequest(result.rows[0]), clientName: result.rows[0].client_name };
  });
}
