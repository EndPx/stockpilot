import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { address, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import type { AgentPrincipal } from "./credentials";
import type { ControlIdentity } from "./clients";
import { controlStore, type ControlQuery, type ControlStore } from "./db";
import { assertAgentExpiryEvidence, type AgentExpiryEvidence } from "../agent-execution/expiry";

export type AgentOperationKind = "BUY" | "SELL" | "TRANSFER_SOL" | "TRANSFER_USDC";
export type AgentOperationStatus = "RESERVED" | "SIGNING" | "SIGNED" | "SUBMITTED" | "UNKNOWN" | "CONFIRMED" | "FAILED" | "REJECTED" | "EXPIRED";
export type AgentOperationLimit = {
  perOperationRaw: string | null;
  dailyRaw: string | null;
  unlimitedPerOperation: boolean;
  unlimitedDaily: boolean;
};
export type AgentWalletPolicyInput = {
  automationOptIn: boolean;
  expiresAt: string | null;
  buyEnabled: boolean;
  sellEnabled: boolean;
  transferSolEnabled: boolean;
  transferUsdcEnabled: boolean;
  allowedAssetIds: string[];
  buyLimit: AgentOperationLimit;
  transferSolLimit: AgentOperationLimit;
  transferUsdcLimit: AgentOperationLimit;
  sellLimits: { assetId: string; limit: AgentOperationLimit }[];
  recipientAllowlist: string[];
  anyRecipient: boolean;
  eligibility: { countryCode: "ID"; nonUsPerson: true; acceptedTerms: true } | null;
};
export type AgentWalletPolicy = AgentWalletPolicyInput & {
  version: number;
  eligibilityAcceptedAt: string | null;
  updatedAt: string | null;
};
/** BUY/USDC use micro-units; SOL uses lamports; SELL uses exact mint raw units. */
export type AgentOperationIntent = {
  clientRequestId: string;
  kind: AgentOperationKind;
  amountRaw: string;
  assetId?: string;
  recipient?: string;
};
/** Server-only recovery data. Never contains a signed transaction or an auth token. */
export type AgentPreparedContext = {
  transaction: string;
  expiresAt: string;
  lastValidBlockHeight: string;
  maximumWalletNativeDebitLamportsRaw: string;
  inputMint?: string;
  outputMint?: string;
  inputDecimals?: number;
  outputDecimals?: number;
  requiredMinimumOutputRaw?: string;
  transfer?: {
    kind: "SOL" | "USDC";
    blockhash: string;
    mint: string | null;
    decimals: 6 | 9;
    networkFeeLamportsRaw: string;
    accountRentLamportsRaw: string;
    sourceTokenAccount: string | null;
    destinationAccount: string;
    createDestinationAta: boolean;
  };
};
export type AgentOperationRecord = {
  id: string;
  accountId: string;
  clientId: string;
  walletAddress: string;
  clientRequestId: string;
  kind: AgentOperationKind;
  amountRaw: string;
  assetId: string | null;
  recipient: string | null;
  intentHash: string;
  policyVersion: number;
  status: AgentOperationStatus;
  providerRequestId: string | null;
  messageFingerprint: string | null;
  transactionSignature: string | null;
  preparedContext: AgentPreparedContext | null;
  actualInputAmountRaw: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  resolvedAt: string | null;
  expiresAt: string | null;
};
export type AgentOperationErrorCode = "INVALID_INPUT" | "CLIENT_NOT_ALLOWED" | "POLICY_DISABLED" |
  "POLICY_EXPIRED" | "POLICY_VERSION_MISMATCH" | "ASSET_NOT_ALLOWED" | "RECIPIENT_NOT_ALLOWED" |
  "ELIGIBILITY_REQUIRED" | "POLICY_LIMIT" | "IDEMPOTENCY_CONFLICT" | "UNRESOLVED_OPERATION" |
  "OPERATION_NOT_FOUND" | "INVALID_TRANSITION";
export class AgentOperationError extends Error {
  constructor(readonly code: AgentOperationErrorCode, message = code.replaceAll("_", " ")) {
    super(message);
    this.name = "AgentOperationError";
  }
}

export const AGENT_TRADE_ASSETS = [
  "prestocks:Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP",
  "xstocks:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[A-Za-z0-9_-]{43}$/;
const MAX_U64 = 18_446_744_073_709_551_615n;
type PolicyRow = { policy: AgentWalletPolicyInput; version: number; eligibility_accepted_at: Date | null; updated_at: Date };
type OperationRow = {
  id: string; account_id: string; client_id: string; wallet_address: string; client_request_id: string;
  kind: AgentOperationKind; amount_raw: string; asset_id: string | null; recipient: string | null;
  intent_hash: string; policy_version: number; status: AgentOperationStatus;
  provider_request_id: string | null; message_fingerprint: string | null; transaction_signature: string | null;
  prepared_context: AgentPreparedContext | null; actual_input_amount_raw: string | null;
  created_at: Date; updated_at: Date; submitted_at: Date | null; resolved_at: Date | null; expires_at: Date | null;
};

function fail(code: AgentOperationErrorCode): never { throw new AgentOperationError(code); }
function raw(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > MAX_U64) return fail("INVALID_INPUT");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_INPUT");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) fail("INVALID_INPUT");
}
function wallet(value: unknown): string {
  if (typeof value !== "string") return fail("INVALID_INPUT");
  try { return address(value).toString(); } catch { return fail("INVALID_INPUT"); }
}
function checkedLimit(value: unknown): AgentOperationLimit {
  const row = object(value);
  exactKeys(row, ["perOperationRaw", "dailyRaw", "unlimitedPerOperation", "unlimitedDaily"]);
  if (typeof row.unlimitedPerOperation !== "boolean" || typeof row.unlimitedDaily !== "boolean") return fail("INVALID_INPUT");
  const perOperationRaw = row.perOperationRaw === null ? null : raw(row.perOperationRaw);
  const dailyRaw = row.dailyRaw === null ? null : raw(row.dailyRaw);
  if ((perOperationRaw === null) !== row.unlimitedPerOperation || (dailyRaw === null) !== row.unlimitedDaily) return fail("INVALID_INPUT");
  return { perOperationRaw, dailyRaw, unlimitedPerOperation: row.unlimitedPerOperation, unlimitedDaily: row.unlimitedDaily };
}

export function defaultAgentWalletPolicy(): AgentWalletPolicy {
  const limit = (): AgentOperationLimit => ({ perOperationRaw: "1000000", dailyRaw: "10000000", unlimitedPerOperation: false, unlimitedDaily: false });
  return { version: 0, automationOptIn: false, expiresAt: null, buyEnabled: false, sellEnabled: false,
    transferSolEnabled: false, transferUsdcEnabled: false, allowedAssetIds: [], buyLimit: limit(),
    transferSolLimit: limit(), transferUsdcLimit: limit(), sellLimits: [], recipientAllowlist: [],
    anyRecipient: false, eligibility: null, eligibilityAcceptedAt: null, updatedAt: null };
}

/** Validates a complete replacement; the API must not fill in consent booleans. */
export function parseAgentWalletPolicy(value: unknown): AgentWalletPolicyInput {
  const row = object(value);
  exactKeys(row, ["automationOptIn", "expiresAt", "buyEnabled", "sellEnabled", "transferSolEnabled", "transferUsdcEnabled",
    "allowedAssetIds", "buyLimit", "transferSolLimit", "transferUsdcLimit", "sellLimits", "recipientAllowlist", "anyRecipient", "eligibility"]);
  for (const key of ["automationOptIn", "buyEnabled", "sellEnabled", "transferSolEnabled", "transferUsdcEnabled", "anyRecipient"]) {
    if (typeof row[key] !== "boolean") fail("INVALID_INPUT");
  }
  let expiresAt: string | null = null;
  if (row.expiresAt !== null) {
    if (typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))) return fail("INVALID_INPUT");
    expiresAt = new Date(row.expiresAt).toISOString();
  }
  if (!Array.isArray(row.allowedAssetIds) || row.allowedAssetIds.length > AGENT_TRADE_ASSETS.length ||
      row.allowedAssetIds.some((item) => typeof item !== "string" || !(AGENT_TRADE_ASSETS as readonly string[]).includes(item)) ||
      new Set(row.allowedAssetIds).size !== row.allowedAssetIds.length) return fail("INVALID_INPUT");
  if (!Array.isArray(row.sellLimits) || row.sellLimits.length > AGENT_TRADE_ASSETS.length) return fail("INVALID_INPUT");
  const allowedAssetIds = row.allowedAssetIds as string[];
  const sellLimits = row.sellLimits.map((item) => {
    const entry = object(item);
    exactKeys(entry, ["assetId", "limit"]);
    if (typeof entry.assetId !== "string" || !allowedAssetIds.includes(entry.assetId)) return fail("INVALID_INPUT");
    return { assetId: entry.assetId, limit: checkedLimit(entry.limit) };
  });
  if (new Set(sellLimits.map((item) => item.assetId)).size !== sellLimits.length) return fail("INVALID_INPUT");
  if (!Array.isArray(row.recipientAllowlist) || row.recipientAllowlist.length > 100) return fail("INVALID_INPUT");
  const recipientAllowlist = row.recipientAllowlist.map(wallet);
  if (new Set(recipientAllowlist).size !== recipientAllowlist.length) return fail("INVALID_INPUT");
  let eligibility: AgentWalletPolicyInput["eligibility"] = null;
  if (row.eligibility !== null) {
    const statement = object(row.eligibility);
    exactKeys(statement, ["countryCode", "nonUsPerson", "acceptedTerms"]);
    if (statement.countryCode !== "ID" || statement.nonUsPerson !== true || statement.acceptedTerms !== true) return fail("INVALID_INPUT");
    eligibility = { countryCode: "ID", nonUsPerson: true, acceptedTerms: true };
  }
  return { automationOptIn: row.automationOptIn as boolean, expiresAt, buyEnabled: row.buyEnabled as boolean,
    sellEnabled: row.sellEnabled as boolean, transferSolEnabled: row.transferSolEnabled as boolean,
    transferUsdcEnabled: row.transferUsdcEnabled as boolean, allowedAssetIds: [...row.allowedAssetIds] as string[],
    buyLimit: checkedLimit(row.buyLimit), transferSolLimit: checkedLimit(row.transferSolLimit),
    transferUsdcLimit: checkedLimit(row.transferUsdcLimit), sellLimits, recipientAllowlist,
    anyRecipient: row.anyRecipient as boolean, eligibility };
}

function normalizePolicy(row: PolicyRow | undefined): AgentWalletPolicy {
  return row ? { ...parseAgentWalletPolicy(row.policy), version: row.version,
    eligibilityAcceptedAt: row.eligibility_accepted_at?.toISOString() ?? null, updatedAt: row.updated_at.toISOString() }
    : defaultAgentWalletPolicy();
}
function normalize(row: OperationRow): AgentOperationRecord {
  return { id: row.id, accountId: row.account_id, clientId: row.client_id, walletAddress: row.wallet_address,
    clientRequestId: row.client_request_id, kind: row.kind, amountRaw: row.amount_raw,
    assetId: row.asset_id, recipient: row.recipient, intentHash: row.intent_hash, policyVersion: row.policy_version,
    status: row.status, providerRequestId: row.provider_request_id, messageFingerprint: row.message_fingerprint,
    transactionSignature: row.transaction_signature, preparedContext: row.prepared_context,
    actualInputAmountRaw: row.actual_input_amount_raw, createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(), submittedAt: row.submitted_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null, expiresAt: row.expires_at?.toISOString() ?? null };
}

async function lockOwner(db: ControlQuery, accountId: string, walletAddress: string): Promise<void> {
  if (!/^did:privy:[A-Za-z0-9_-]{1,118}$/.test(accountId)) return fail("CLIENT_NOT_ALLOWED");
  const result = await db.query<{ primary_wallet_address: string }>(
    "SELECT primary_wallet_address FROM control_accounts WHERE id = $1 FOR UPDATE", [accountId]);
  if (result.rows[0]?.primary_wallet_address !== wallet(walletAddress)) fail("CLIENT_NOT_ALLOWED");
  await db.query("INSERT INTO control_wallet_operation_locks(wallet_address) VALUES ($1) ON CONFLICT DO NOTHING", [walletAddress]);
  await db.query("SELECT wallet_address FROM control_wallet_operation_locks WHERE wallet_address = $1 FOR UPDATE", [walletAddress]);
}
async function lockOwnedClient(db: ControlQuery, identity: ControlIdentity, clientId: string, active = true): Promise<void> {
  if (!UUID.test(clientId)) return fail("INVALID_INPUT");
  await lockOwner(db, identity.privyUserId, identity.walletAddress);
  const result = await db.query<{ id: string }>(
    `SELECT id FROM control_clients WHERE id = $1 AND account_id = $2
      ${active ? "AND status = 'ACTIVE' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())" : ""} FOR UPDATE`,
    [clientId, identity.privyUserId]);
  if (!result.rows.length) fail("CLIENT_NOT_ALLOWED");
}

/** Locks the live credential/OAuth row as well as client; cached scopes never grant execution. */
async function lockPrincipal(db: ControlQuery, principal: AgentPrincipal): Promise<void> {
  if (!UUID.test(principal.clientId)) return fail("CLIENT_NOT_ALLOWED");
  await lockOwner(db, principal.accountId, principal.walletAddress);
  const apiKey = principal.authMethod === "api_key";
  if (apiKey && !UUID.test(principal.credentialId)) return fail("CLIENT_NOT_ALLOWED");
  const authJoin = apiKey ? "JOIN control_credentials auth ON auth.client_id = c.id AND auth.id = $3::uuid"
    : "JOIN control_oauth_connections auth ON auth.client_id = c.id AND auth.account_id = c.account_id AND auth.issuer = $3 AND auth.subject = $4 AND auth.oauth_client_id = $5";
  const authExpiry = apiKey ? "AND (auth.expires_at IS NULL OR auth.expires_at > now())" : "";
  const authParams = apiKey ? [principal.credentialId] : [principal.oauthIssuer, principal.oauthSubject, principal.oauthClientId];
  const result = await db.query<{ id: string }>(
    `SELECT c.id FROM control_clients c ${authJoin}
     WHERE c.id = $1 AND c.account_id = $2 AND c.status = 'ACTIVE' AND c.revoked_at IS NULL
       AND (c.expires_at IS NULL OR c.expires_at > now()) AND auth.revoked_at IS NULL ${authExpiry}
     FOR UPDATE OF c, auth`, [principal.clientId, principal.accountId, ...authParams]);
  if (!result.rows.length) fail("CLIENT_NOT_ALLOWED");
}
async function readPolicy(db: ControlQuery, accountId: string, clientId: string, walletAddress: string): Promise<AgentWalletPolicy> {
  const result = await db.query<PolicyRow>(
    "SELECT policy, version, eligibility_accepted_at, updated_at FROM control_agent_wallet_policies WHERE account_id = $1 AND client_id = $2 AND wallet_address = $3 FOR UPDATE",
    [accountId, clientId, walletAddress]);
  return normalizePolicy(result.rows[0]);
}

export async function getAgentWalletPolicy(identity: ControlIdentity, clientId: string, store: ControlStore = controlStore): Promise<AgentWalletPolicy> {
  return store.transaction(async (db) => {
    await lockOwnedClient(db, identity, clientId, false);
    return readPolicy(db, identity.privyUserId, clientId, identity.walletAddress);
  });
}
export async function updateAgentWalletPolicy(identity: ControlIdentity, clientId: string,
  input: AgentWalletPolicyInput & { expectedVersion: number }, store: ControlStore = controlStore): Promise<AgentWalletPolicy> {
  const { expectedVersion, ...candidate } = input;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return fail("INVALID_INPUT");
  const policy = parseAgentWalletPolicy(candidate);
  if (policy.expiresAt !== null && Date.parse(policy.expiresAt) <= Date.now()) return fail("POLICY_EXPIRED");
  return store.transaction(async (db) => {
    await lockOwnedClient(db, identity, clientId);
    const previous = await readPolicy(db, identity.privyUserId, clientId, identity.walletAddress);
    if (previous.version !== expectedVersion) return fail("POLICY_VERSION_MISMATCH");
    const saved = await db.query<PolicyRow>(
      `INSERT INTO control_agent_wallet_policies(client_id,account_id,wallet_address,policy,version,eligibility_accepted_at)
       VALUES ($1,$2,$3,$4::jsonb,1,CASE WHEN $5 THEN now() ELSE NULL END)
       ON CONFLICT (client_id) DO UPDATE SET policy = EXCLUDED.policy, version = control_agent_wallet_policies.version + 1,
         eligibility_accepted_at = CASE WHEN $5 THEN COALESCE(control_agent_wallet_policies.eligibility_accepted_at, now()) ELSE NULL END,
         updated_at = now() RETURNING policy,version,eligibility_accepted_at,updated_at`,
      [clientId, identity.privyUserId, identity.walletAddress, JSON.stringify(policy), policy.eligibility !== null]);
    await db.query("INSERT INTO control_activity_events(id,account_id,client_id,event_type,actor_type,details) VALUES ($1,$2,$3,'POLICY_UPDATED','USER',$4::jsonb)",
      [randomUUID(), identity.privyUserId, clientId, JSON.stringify({ walletPolicyVersion: saved.rows[0].version })]);
    return normalizePolicy(saved.rows[0]);
  });
}

export function parseAgentOperationIntent(value: unknown): AgentOperationIntent {
  const row = object(value);
  exactKeys(row, ["clientRequestId", "kind", "amountRaw", "assetId", "recipient"]);
  if (typeof row.clientRequestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(row.clientRequestId) ||
    !["BUY", "SELL", "TRANSFER_SOL", "TRANSFER_USDC"].includes(row.kind as string)) return fail("INVALID_INPUT");
  const amountRaw = raw(row.amountRaw);
  if (row.kind === "BUY" || row.kind === "SELL") {
    if (row.recipient !== undefined || typeof row.assetId !== "string" || !(AGENT_TRADE_ASSETS as readonly string[]).includes(row.assetId)) return fail("ASSET_NOT_ALLOWED");
    return { clientRequestId: row.clientRequestId, kind: row.kind, amountRaw, assetId: row.assetId };
  }
  if (row.assetId !== undefined) return fail("INVALID_INPUT");
  return { clientRequestId: row.clientRequestId, kind: row.kind as AgentOperationKind, amountRaw, recipient: wallet(row.recipient) };
}
function intentHash(principal: AgentPrincipal, intent: AgentOperationIntent): string {
  return createHash("sha256").update(JSON.stringify([principal.accountId, principal.clientId, principal.walletAddress,
    intent.clientRequestId, intent.kind, intent.amountRaw, intent.assetId ?? null, intent.recipient ?? null])).digest("base64url");
}
function rowIntent(row: OperationRow): AgentOperationIntent {
  return { clientRequestId: row.client_request_id, kind: row.kind, amountRaw: row.amount_raw,
    ...(row.asset_id ? { assetId: row.asset_id } : {}), ...(row.recipient ? { recipient: row.recipient } : {}) };
}
async function assertPolicy(db: ControlQuery, principal: AgentPrincipal, intent: AgentOperationIntent,
  policy: AgentWalletPolicy, excludeId: string | null = null, expectedVersion?: number): Promise<void> {
  if (expectedVersion !== undefined && policy.version !== expectedVersion) return fail("POLICY_VERSION_MISMATCH");
  const enabled = intent.kind === "BUY" ? policy.buyEnabled : intent.kind === "SELL" ? policy.sellEnabled
    : intent.kind === "TRANSFER_SOL" ? policy.transferSolEnabled : policy.transferUsdcEnabled;
  if (!policy.automationOptIn || !enabled || policy.version === 0) return fail("POLICY_DISABLED");
  if (policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now()) return fail("POLICY_EXPIRED");
  let limit: AgentOperationLimit;
  if (intent.kind === "BUY" || intent.kind === "SELL") {
    if (!intent.assetId || !policy.allowedAssetIds.includes(intent.assetId)) return fail("ASSET_NOT_ALLOWED");
    if (!policy.eligibility || !policy.eligibilityAcceptedAt) return fail("ELIGIBILITY_REQUIRED");
    const sell = policy.sellLimits.find((item) => item.assetId === intent.assetId);
    if (intent.kind === "SELL" && !sell) return fail("ASSET_NOT_ALLOWED");
    limit = intent.kind === "BUY" ? policy.buyLimit : sell!.limit;
  } else {
    if (!intent.recipient || (!policy.anyRecipient && !policy.recipientAllowlist.includes(intent.recipient))) return fail("RECIPIENT_NOT_ALLOWED");
    limit = intent.kind === "TRANSFER_SOL" ? policy.transferSolLimit : policy.transferUsdcLimit;
  }
  const amount = BigInt(intent.amountRaw);
  if (limit.perOperationRaw !== null && amount > BigInt(limit.perOperationRaw)) return fail("POLICY_LIMIT");
  const usage = await db.query<{ used_raw: string }>(
    `SELECT COALESCE(sum(CASE WHEN status = 'CONFIRMED' THEN actual_input_amount_raw ELSE amount_raw END),0)::text AS used_raw
     FROM control_agent_operations WHERE account_id = $1 AND client_id = $2 AND kind = $3
       AND ($3 <> 'SELL' OR asset_id = $4) AND ($5::uuid IS NULL OR id <> $5)
       AND (status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN') OR
         (status = 'CONFIRMED' AND resolved_at >= now() - interval '24 hours'))`,
    [principal.accountId, principal.clientId, intent.kind, intent.assetId ?? null, excludeId]);
  if (limit.dailyRaw !== null && BigInt(usage.rows[0].used_raw) + amount > BigInt(limit.dailyRaw)) return fail("POLICY_LIMIT");
}
async function event(db: ControlQuery, operationId: string, status: AgentOperationStatus): Promise<void> {
  await db.query("INSERT INTO control_agent_operation_events(id,operation_id,status) VALUES ($1,$2,$3)", [randomUUID(), operationId, status]);
  await db.query(
    `INSERT INTO control_activity_events(id,account_id,client_id,event_type,actor_type,details)
     SELECT $1,account_id,client_id,'AGENT_' || kind || '_' || $3,
       CASE WHEN $3 = 'RESERVED' THEN 'CLIENT' ELSE 'SYSTEM' END,
       jsonb_build_object('operationId',id,'kind',kind)
     FROM control_agent_operations WHERE id = $2`, [randomUUID(), operationId, status]);
}
async function lockedOperation(db: ControlQuery, principal: AgentPrincipal, id: string): Promise<OperationRow> {
  if (!UUID.test(id)) return fail("OPERATION_NOT_FOUND");
  const result = await db.query<OperationRow>(
    "SELECT * FROM control_agent_operations WHERE id = $1 AND account_id = $2 AND client_id = $3 AND wallet_address = $4 FOR UPDATE",
    [id, principal.accountId, principal.clientId, principal.walletAddress]);
  if (!result.rows.length) return fail("OPERATION_NOT_FOUND");
  return result.rows[0];
}

/** Reserves before any external signing call. Repeating an ID never starts work again. */
export async function reserveAgentOperation(principal: AgentPrincipal, input: AgentOperationIntent,
  store: ControlStore = controlStore): Promise<{ created: boolean; operation: AgentOperationRecord }> {
  const intent = parseAgentOperationIntent(input);
  const hash = intentHash(principal, intent);
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    const existing = await db.query<OperationRow>(
      "SELECT * FROM control_agent_operations WHERE account_id = $1 AND client_id = $2 AND client_request_id = $3 FOR UPDATE",
      [principal.accountId, principal.clientId, intent.clientRequestId]);
    if (existing.rows.length) {
      if (existing.rows[0].intent_hash !== hash) return fail("IDEMPOTENCY_CONFLICT");
      return { created: false, operation: normalize(existing.rows[0]) };
    }
    const policy = await readPolicy(db, principal.accountId, principal.clientId, principal.walletAddress);
    await assertPolicy(db, principal, intent, policy);
    const pending = await db.query<{ id: string }>(
      `SELECT id FROM control_agent_operations WHERE (account_id = $1 OR wallet_address = $2) AND status IN ('RESERVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN')
       UNION ALL SELECT id FROM control_manual_investment_executions WHERE (account_id = $1 OR wallet_address = $2) AND status IN ('CLAIMED','SUBMITTED','UNKNOWN') LIMIT 1`,
      [principal.accountId, principal.walletAddress]);
    if (pending.rows.length) return fail("UNRESOLVED_OPERATION");
    const inserted = await db.query<OperationRow>(
      `INSERT INTO control_agent_operations(id,account_id,client_id,wallet_address,client_request_id,kind,amount_raw,asset_id,recipient,intent_hash,policy_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [randomUUID(), principal.accountId, principal.clientId, principal.walletAddress, intent.clientRequestId, intent.kind,
        intent.amountRaw, intent.assetId ?? null, intent.recipient ?? null, hash, policy.version]);
    await event(db, inserted.rows[0].id, "RESERVED");
    return { created: true, operation: normalize(inserted.rows[0]) };
  });
}

function checkPrepared(input: { providerRequestId: string; messageFingerprint: string; preparedContext: AgentPreparedContext },
  row: OperationRow): AgentPreparedContext {
  if (typeof input.providerRequestId !== "string" || input.providerRequestId.length < 1 || input.providerRequestId.length > 256 ||
    !HASH.test(input.messageFingerprint)) return fail("INVALID_INPUT");
  const context = object(input.preparedContext);
  exactKeys(context, ["transaction", "expiresAt", "lastValidBlockHeight", "maximumWalletNativeDebitLamportsRaw",
    "inputMint", "outputMint", "inputDecimals", "outputDecimals", "requiredMinimumOutputRaw", "transfer"]);
  if (typeof context.transaction !== "string" || context.transaction.length > 2000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(context.transaction) || typeof context.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= Date.now()) return fail("INVALID_INPUT");
  raw(context.lastValidBlockHeight);
  raw(context.maximumWalletNativeDebitLamportsRaw);
  try {
    const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(context.transaction));
    if (Object.values(decoded.signatures).some((signature) => signature !== null && signature.some((byte) => byte !== 0))) return fail("INVALID_INPUT");
    const commitment = createHash("sha256").update(Uint8Array.from(decoded.messageBytes)).digest("base64url");
    if (commitment !== input.messageFingerprint || !Object.keys(decoded.signatures).includes(row.wallet_address)) return fail("INVALID_INPUT");
  } catch { return fail("INVALID_INPUT"); }
  for (const key of ["inputMint", "outputMint"]) if (context[key] !== undefined) wallet(context[key]);
  for (const key of ["inputDecimals", "outputDecimals"]) if (context[key] !== undefined &&
    (!Number.isInteger(context[key]) || (context[key] as number) < 0 || (context[key] as number) > 18)) return fail("INVALID_INPUT");
  if (context.requiredMinimumOutputRaw !== undefined) raw(context.requiredMinimumOutputRaw);
  if (row.kind === "BUY" || row.kind === "SELL") {
    if (context.transfer !== undefined) return fail("INVALID_INPUT");
  } else {
    const transfer = object(context.transfer);
    exactKeys(transfer, ["kind", "blockhash", "mint", "decimals", "networkFeeLamportsRaw", "accountRentLamportsRaw",
      "sourceTokenAccount", "destinationAccount", "createDestinationAta"]);
    if (transfer.kind !== (row.kind === "TRANSFER_SOL" ? "SOL" : "USDC") || typeof transfer.blockhash !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(transfer.blockhash) ||
      transfer.decimals !== (row.kind === "TRANSFER_SOL" ? 9 : 6) || typeof transfer.createDestinationAta !== "boolean") return fail("INVALID_INPUT");
    for (const key of ["networkFeeLamportsRaw", "accountRentLamportsRaw"]) {
      if (transfer[key] !== "0") raw(transfer[key]);
    }
    wallet(transfer.destinationAccount);
    if (row.kind === "TRANSFER_SOL") {
      if (transfer.mint !== null || transfer.sourceTokenAccount !== null || transfer.createDestinationAta !== false ||
        transfer.destinationAccount !== row.recipient || transfer.accountRentLamportsRaw !== "0") return fail("INVALID_INPUT");
    } else {
      if (transfer.mint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") return fail("INVALID_INPUT");
      wallet(transfer.sourceTokenAccount);
    }
  }
  return { ...input.preparedContext, expiresAt: new Date(context.expiresAt).toISOString() };
}

/** Only claimed:true may invoke the remote signer. A SIGNING retry is never re-signed. */
export async function beginAgentOperationSigning(principal: AgentPrincipal, id: string,
  input: { providerRequestId: string; messageFingerprint: string; preparedContext: AgentPreparedContext },
  store: ControlStore = controlStore): Promise<{ claimed: boolean; operation: AgentOperationRecord }> {
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    const row = await lockedOperation(db, principal, id);
    if (row.status !== "RESERVED") {
      if (row.provider_request_id !== input.providerRequestId || row.message_fingerprint !== input.messageFingerprint) return fail("IDEMPOTENCY_CONFLICT");
      return { claimed: false, operation: normalize(row) };
    }
    const prepared = checkPrepared(input, row);
    const reused = await db.query<{ id: string }>(
      "SELECT id FROM control_agent_operations WHERE account_id = $1 AND provider_request_id = $2 AND id <> $3 LIMIT 1",
      [principal.accountId, input.providerRequestId, id]);
    if (reused.rows.length) return fail("IDEMPOTENCY_CONFLICT");
    const policy = await readPolicy(db, principal.accountId, principal.clientId, principal.walletAddress);
    await assertPolicy(db, principal, rowIntent(row), policy, row.id, row.policy_version);
    const updated = await db.query<OperationRow>(
      `UPDATE control_agent_operations SET status = 'SIGNING',provider_request_id = $2,message_fingerprint = $3,
         prepared_context = $4::jsonb,expires_at = $5::timestamptz,updated_at = now() WHERE id = $1 RETURNING *`,
      [id, input.providerRequestId, input.messageFingerprint, JSON.stringify(prepared), prepared.expiresAt]);
    await event(db, id, "SIGNING");
    return { claimed: true, operation: normalize(updated.rows[0]) };
  });
}

export async function recordAgentOperationSigned(principal: AgentPrincipal, id: string,
  input: { transactionSignature: string }, store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  if (typeof input.transactionSignature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(input.transactionSignature)) return fail("INVALID_INPUT");
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    const row = await lockedOperation(db, principal, id);
    if (row.transaction_signature !== null) {
      if (row.transaction_signature !== input.transactionSignature) return fail("IDEMPOTENCY_CONFLICT");
      return normalize(row);
    }
    if (row.status !== "SIGNING") return fail("INVALID_TRANSITION");
    // Persist the signature even if policy changed while Privy was responding.
    // This bookkeeping grants no submission permission; beginSubmission rechecks.
    const updated = await db.query<OperationRow>(
      "UPDATE control_agent_operations SET status = 'SIGNED',transaction_signature = $2,updated_at = now() WHERE id = $1 RETURNING *",
      [id, input.transactionSignature]);
    await event(db, id, "SIGNED");
    return normalize(updated.rows[0]);
  });
}

/** Marks the send attempt before HTTP. Only claimed:true may send the stored message once. */
export async function beginAgentOperationSubmission(principal: AgentPrincipal, id: string,
  store: ControlStore = controlStore): Promise<{ claimed: boolean; operation: AgentOperationRecord }> {
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    const row = await lockedOperation(db, principal, id);
    if (row.status !== "SIGNED") return { claimed: false, operation: normalize(row) };
    if (!row.expires_at || row.expires_at.getTime() <= Date.now()) return fail("POLICY_EXPIRED");
    const policy = await readPolicy(db, principal.accountId, principal.clientId, principal.walletAddress);
    await assertPolicy(db, principal, rowIntent(row), policy, row.id, row.policy_version);
    const updated = await db.query<OperationRow>(
      "UPDATE control_agent_operations SET status = 'SUBMITTED',submitted_at = now(),updated_at = now() WHERE id = $1 RETURNING *", [id]);
    await event(db, id, "SUBMITTED");
    return { claimed: true, operation: normalize(updated.rows[0]) };
  });
}

export async function markAgentOperationUnknown(principal: AgentPrincipal, id: string,
  store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    const row = await lockedOperation(db, principal, id);
    if (row.status === "UNKNOWN") return normalize(row);
    if (!["SIGNING", "SIGNED", "SUBMITTED"].includes(row.status)) return fail("INVALID_TRANSITION");
    const updated = await db.query<OperationRow>("UPDATE control_agent_operations SET status = 'UNKNOWN',updated_at = now() WHERE id = $1 RETURNING *", [id]);
    await event(db, id, "UNKNOWN");
    return normalize(updated.rows[0]);
  });
}

/** An untouched reservation can be released. SIGNING/UNKNOWN are never released by timeout. */
export async function rejectAgentOperationBeforeSigning(principal: AgentPrincipal, id: string,
  store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    const row = await lockedOperation(db, principal, id);
    if (row.status === "REJECTED" && !row.transaction_signature) return normalize(row);
    if (row.status !== "RESERVED") return fail("INVALID_TRANSITION");
    const updated = await db.query<OperationRow>(
      "UPDATE control_agent_operations SET status = 'REJECTED',resolved_at = now(),updated_at = now() WHERE id = $1 RETURNING *", [id]);
    await event(db, id, "REJECTED");
    return normalize(updated.rows[0]);
  });
}

async function releaseOwnedUnsent(identity: ControlIdentity, clientId: string, id: string,
  expected: "RESERVED" | "SIGNED", store: ControlStore): Promise<AgentOperationRecord> {
  if (!UUID.test(id)) return fail("OPERATION_NOT_FOUND");
  return store.transaction(async (db) => {
    // Revocation must forbid spending, not prevent releasing a provably unsent
    // reservation. This function grants no signing/submission capability.
    await lockOwnedClient(db, identity, clientId, false);
    const result = await db.query<OperationRow>(
      "SELECT * FROM control_agent_operations WHERE id = $1 AND account_id = $2 AND client_id = $3 AND wallet_address = $4 FOR UPDATE",
      [id, identity.privyUserId, clientId, identity.walletAddress]);
    const row = result.rows[0];
    if (!row) return fail("OPERATION_NOT_FOUND");
    if (row.status === "REJECTED" && row.submitted_at === null) return normalize(row);
    if (row.status !== expected || row.submitted_at !== null) return fail("INVALID_TRANSITION");
    const updated = await db.query<OperationRow>(
      "UPDATE control_agent_operations SET status = 'REJECTED',resolved_at = now(),updated_at = now() WHERE id = $1 RETURNING *", [id]);
    await event(db, id, "REJECTED");
    return normalize(updated.rows[0]);
  });
}

/** Internal gateway only. SIGNED + no submission fence proves no send was authorized.
 * Do not call for an ambiguous beginSubmission result; UNKNOWN/SUBMITTED never release.
 * The already verified principal identifies only its own operation; revocation is safe.
 */
export function rejectAgentOperationBeforeSubmission(principal: AgentPrincipal, id: string,
  store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  return releaseOwnedUnsent({ privyUserId: principal.accountId, walletAddress: principal.walletAddress }, principal.clientId, id, "SIGNED", store);
}

/** A verified owner may cancel an untouched reservation even after revoking its client. */
export function cancelOwnedAgentOperationReservation(identity: ControlIdentity, clientId: string, id: string,
  store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  return releaseOwnedUnsent(identity, clientId, id, "RESERVED", store);
}

export type AgentOperationReconciliation = {
  outcome: "CONFIRMED" | "FAILED" | "REJECTED";
  evidence: "FINALIZED_SUCCESS" | "FINALIZED_FAILURE" | "RPC_PREFLIGHT_REJECTED";
  actualInputAmountRaw?: string;
  expiryEvidence?: never;
} | { outcome: "EXPIRED"; evidence: "EXPIRED_UNLANDED_QUORUM"; expiryEvidence: AgentExpiryEvidence; actualInputAmountRaw?: never };
async function reconcile(db: ControlQuery, row: OperationRow, input: AgentOperationReconciliation): Promise<AgentOperationRecord> {
  if (!((input.outcome === "CONFIRMED" && input.evidence === "FINALIZED_SUCCESS") ||
    (input.outcome === "FAILED" && input.evidence === "FINALIZED_FAILURE") ||
    (input.outcome === "REJECTED" && input.evidence === "RPC_PREFLIGHT_REJECTED") ||
    (input.outcome === "EXPIRED" && input.evidence === "EXPIRED_UNLANDED_QUORUM"))) return fail("INVALID_INPUT");
  const actual = input.outcome === "CONFIRMED" ? raw(input.actualInputAmountRaw) : null;
  if ((actual !== null && BigInt(actual) > BigInt(row.amount_raw)) ||
    (actual === null && input.actualInputAmountRaw !== undefined)) return fail("INVALID_INPUT");
  if (row.status === input.outcome) {
    if (row.actual_input_amount_raw !== actual) return fail("IDEMPOTENCY_CONFLICT");
    return normalize(row);
  }
  if (!row.transaction_signature ||
    (input.outcome === "REJECTED" ? row.status !== "SUBMITTED" : !["SUBMITTED", "UNKNOWN"].includes(row.status))) return fail("INVALID_TRANSITION");
  if (input.outcome === "EXPIRED") {
    try { assertAgentExpiryEvidence(normalize(row), input.expiryEvidence); }
    catch { return fail("INVALID_INPUT"); }
  }
  const updated = await db.query<OperationRow>(
    "UPDATE control_agent_operations SET status = $2,actual_input_amount_raw = $3,expiry_evidence = $4::jsonb,resolved_at = now(),updated_at = now() WHERE id = $1 RETURNING *",
    [row.id, input.outcome, actual, input.outcome === "EXPIRED" ? JSON.stringify(input.expiryEvidence) : null]);
  await event(db, row.id, input.outcome);
  return normalize(updated.rows[0]);
}

/** Finalized receipts or a separately validated two-provider expiry assessment;
 * an absent RPC result alone is never failure evidence. */
export async function reconcileAgentOperation(principal: AgentPrincipal, id: string, input: AgentOperationReconciliation,
  store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    return reconcile(db, await lockedOperation(db, principal, id), input);
  });
}

/** Owner can account for chain-final results after a client/policy was revoked; this never signs or sends. */
export async function reconcileOwnedAgentOperation(identity: ControlIdentity, clientId: string, id: string,
  input: AgentOperationReconciliation, store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  return store.transaction(async (db) => {
    await lockOwnedClient(db, identity, clientId, false);
    const result = await db.query<OperationRow>(
      "SELECT * FROM control_agent_operations WHERE id = $1 AND account_id = $2 AND client_id = $3 AND wallet_address = $4 FOR UPDATE",
      [id, identity.privyUserId, clientId, identity.walletAddress]);
    if (!result.rows.length) return fail("OPERATION_NOT_FOUND");
    return reconcile(db, result.rows[0], input);
  });
}

export async function getAgentOperation(principal: AgentPrincipal, id: string,
  store: ControlStore = controlStore): Promise<AgentOperationRecord> {
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    return normalize(await lockedOperation(db, principal, id));
  });
}
export async function listAgentOperations(principal: AgentPrincipal, input: { limit?: number } = {},
  store: ControlStore = controlStore): Promise<AgentOperationRecord[]> {
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return fail("INVALID_INPUT");
  return store.transaction(async (db) => {
    await lockPrincipal(db, principal);
    const result = await db.query<OperationRow>(
      "SELECT * FROM control_agent_operations WHERE account_id = $1 AND client_id = $2 AND wallet_address = $3 ORDER BY created_at DESC,id DESC LIMIT $4",
      [principal.accountId, principal.clientId, principal.walletAddress, limit]);
    return result.rows.map(normalize);
  });
}
