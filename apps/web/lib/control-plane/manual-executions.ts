import "server-only";

import { randomUUID } from "node:crypto";
import { address } from "@solana/kit";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { controlStore, type ControlQuery, type ControlStore } from "./db";

export type ManualBuyStatus = "CLAIMED" | "SUBMITTED" | "UNKNOWN" | "CONFIRMED" | "FAILED" | "REJECTED";
export type ManualTradeSide = "BUY" | "SELL";

export type ManualBuyExecutionKey = {
  accountId: string;
  walletAddress: string;
  providerRequestId: string;
  transactionSignature: string;
};

export type ManualBuyClaimInput = ManualBuyExecutionKey & {
  side?: ManualTradeSide;
  messageFingerprint: string;
  inputMint: string;
  outputMint: string;
  inputDecimals?: number;
  outputDecimals: number;
  inputAmountRaw: string;
  requiredMinimumOutputRaw: string;
  maximumWalletNativeDebitLamportsRaw: string;
  expiresAt: string;
};

export type ManualBuyExecutionRecord = ManualBuyClaimInput & {
  id: string;
  side: ManualTradeSide;
  inputDecimals: number;
  status: ManualBuyStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  resolvedAt: string | null;
  actualInputAmountRaw: string | null;
  actualOutputAmountRaw: string | null;
  actualWalletNativeDebitLamportsRaw: string | null;
};

type ExecutionRow = {
  id: string;
  account_id: string;
  wallet_address: string;
  provider_request_id: string;
  message_fingerprint: string;
  transaction_signature: string;
  side: ManualTradeSide;
  input_mint: string;
  output_mint: string;
  input_decimals: number;
  output_decimals: number;
  input_amount_raw: string;
  required_minimum_output_raw: string;
  maximum_wallet_native_debit_lamports_raw: string;
  status: ManualBuyStatus;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  submitted_at: Date | null;
  resolved_at: Date | null;
  actual_input_amount_raw: string | null;
  actual_output_amount_raw: string | null;
  actual_wallet_native_debit_lamports_raw: string | null;
};

export class ManualBuyLedgerError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "WALLET_BINDING_MISMATCH" | "IDEMPOTENCY_CONFLICT" |
      "ORDER_EXPIRED" | "NOT_FOUND" | "INVALID_TRANSITION" | "UNRESOLVED_TRADE",
    message: string,
  ) {
    super(message);
    this.name = "ManualBuyLedgerError";
  }
}

const MAX_U64 = 18_446_744_073_709_551_615n;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{80,88}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function invalid(): never {
  throw new ManualBuyLedgerError("INVALID_INPUT", "Invalid manual BUY execution data.");
}

function parseAddress(value: string): string {
  try { return address(value).toString(); } catch { return invalid(); }
}

function rawAmount(value: string): string {
  if (typeof value !== "string" || value.length > 20 || !/^\d+$/.test(value)) return invalid();
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_U64) return invalid();
  return amount.toString();
}

function validateKey(input: ManualBuyExecutionKey): ManualBuyExecutionKey {
  if (typeof input.accountId !== "string" || input.accountId.length < 3 || input.accountId.length > 128 ||
    typeof input.providerRequestId !== "string" || input.providerRequestId.length < 1 || input.providerRequestId.length > 256 ||
    typeof input.transactionSignature !== "string" || !SIGNATURE_PATTERN.test(input.transactionSignature)) return invalid();
  return { ...input, walletAddress: parseAddress(input.walletAddress) };
}

function validateClaim(input: ManualBuyClaimInput): ManualBuyClaimInput {
  const key = validateKey(input);
  const side = input.side ?? "BUY";
  const inputMint = parseAddress(input.inputMint);
  const outputMint = parseAddress(input.outputMint);
  const inputDecimals = input.inputDecimals ?? (side === "BUY" ? 6 : -1);
  if ((side !== "BUY" && side !== "SELL") ||
    (side === "BUY" ? inputMint !== SOLANA_MAINNET_USDC_MINT || inputDecimals !== 6
      : outputMint !== SOLANA_MAINNET_USDC_MINT || inputMint === SOLANA_MAINNET_USDC_MINT || input.outputDecimals !== 6) ||
    outputMint === inputMint || !Number.isInteger(inputDecimals) || inputDecimals < 0 || inputDecimals > 255 ||
    !Number.isInteger(input.outputDecimals) || input.outputDecimals < 0 || input.outputDecimals > 255 ||
    typeof input.messageFingerprint !== "string" || !FINGERPRINT_PATTERN.test(input.messageFingerprint)) return invalid();
  const expiry = new Date(input.expiresAt);
  if (!Number.isFinite(expiry.getTime())) return invalid();
  return { ...key, side, messageFingerprint: input.messageFingerprint, inputMint, outputMint,
    inputDecimals,
    outputDecimals: input.outputDecimals, inputAmountRaw: rawAmount(input.inputAmountRaw),
    requiredMinimumOutputRaw: rawAmount(input.requiredMinimumOutputRaw),
    maximumWalletNativeDebitLamportsRaw: rawAmount(input.maximumWalletNativeDebitLamportsRaw),
    expiresAt: expiry.toISOString() };
}

function normalize(row: ExecutionRow): ManualBuyExecutionRecord {
  return {
    id: row.id, accountId: row.account_id, walletAddress: row.wallet_address,
    providerRequestId: row.provider_request_id, messageFingerprint: row.message_fingerprint,
    transactionSignature: row.transaction_signature, side: row.side ?? "BUY", inputMint: row.input_mint,
    outputMint: row.output_mint, inputDecimals: row.input_decimals ?? 6, outputDecimals: row.output_decimals,
    inputAmountRaw: row.input_amount_raw,
    requiredMinimumOutputRaw: row.required_minimum_output_raw,
    maximumWalletNativeDebitLamportsRaw: row.maximum_wallet_native_debit_lamports_raw,
    status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(), submittedAt: row.submitted_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    actualInputAmountRaw: row.actual_input_amount_raw,
    actualOutputAmountRaw: row.actual_output_amount_raw,
    actualWalletNativeDebitLamportsRaw: row.actual_wallet_native_debit_lamports_raw,
  };
}

function matchesClaim(row: ExecutionRow, input: ManualBuyClaimInput): boolean {
  return row.account_id === input.accountId && row.wallet_address === input.walletAddress &&
    row.provider_request_id === input.providerRequestId && row.transaction_signature === input.transactionSignature &&
    row.message_fingerprint === input.messageFingerprint && row.input_mint === input.inputMint &&
    row.output_mint === input.outputMint && (row.side ?? "BUY") === input.side &&
    (row.input_decimals ?? 6) === input.inputDecimals && row.output_decimals === input.outputDecimals &&
    row.input_amount_raw === input.inputAmountRaw &&
    row.required_minimum_output_raw === input.requiredMinimumOutputRaw &&
    row.maximum_wallet_native_debit_lamports_raw === input.maximumWalletNativeDebitLamportsRaw &&
    row.expires_at.toISOString() === input.expiresAt;
}

async function event(db: ControlQuery, executionId: string, status: ManualBuyStatus): Promise<void> {
  await db.query(
    "INSERT INTO control_manual_execution_events(id, execution_id, status) VALUES ($1, $2, $3)",
    [randomUUID(), executionId, status],
  );
}

async function ensureOwnerBinding(db: ControlQuery, accountId: string, walletAddress: string): Promise<void> {
  await db.query(
    "INSERT INTO control_accounts(id, primary_wallet_address) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [accountId, walletAddress],
  );
  const result = await db.query<{ primary_wallet_address: string }>(
    "SELECT primary_wallet_address FROM control_accounts WHERE id = $1 FOR UPDATE", [accountId],
  );
  if (result.rows[0]?.primary_wallet_address !== walletAddress) {
    throw new ManualBuyLedgerError("WALLET_BINDING_MISMATCH", "The verified StockPilot wallet binding changed.");
  }
}

/** Caller must provide an already verified Privy identity and signed transaction identity.
 * A true claim is the only state from which a caller may submit to Jupiter.
 * Any existing claim, even UNKNOWN or FAILED, must be read/reconciled, never resubmitted.
 */
export async function claimManualBuyExecution(input: ManualBuyClaimInput,
  store: ControlStore = controlStore): Promise<{ claimed: boolean; record: ManualBuyExecutionRecord }> {
  const claim = validateClaim(input);
  if (Date.parse(claim.expiresAt) <= Date.now()) {
    throw new ManualBuyLedgerError("ORDER_EXPIRED", "This BUY order expired before submission.");
  }
  return store.transaction(async (db) => {
    await ensureOwnerBinding(db, claim.accountId, claim.walletAddress);
    const inserted = await db.query<ExecutionRow>(
      `INSERT INTO control_manual_investment_executions
         (id, account_id, wallet_address, provider_request_id, message_fingerprint,
          transaction_signature, side, input_mint, output_mint, input_decimals, output_decimals, input_amount_raw,
          required_minimum_output_raw, maximum_wallet_native_debit_lamports_raw, expires_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz
       WHERE $15::timestamptz > now()
       ON CONFLICT DO NOTHING RETURNING *`,
      [randomUUID(), claim.accountId, claim.walletAddress, claim.providerRequestId,
        claim.messageFingerprint, claim.transactionSignature, claim.side, claim.inputMint,
        claim.outputMint, claim.inputDecimals, claim.outputDecimals, claim.inputAmountRaw,
        claim.requiredMinimumOutputRaw, claim.maximumWalletNativeDebitLamportsRaw,
        claim.expiresAt],
    );
    if (inserted.rows.length) {
      await event(db, inserted.rows[0].id, "CLAIMED");
      return { claimed: true, record: normalize(inserted.rows[0]) };
    }
    const existing = await db.query<ExecutionRow>(
      `SELECT * FROM control_manual_investment_executions
       WHERE account_id = $1 AND provider_request_id = $2 FOR UPDATE`,
      [claim.accountId, claim.providerRequestId],
    );
    if (!existing.rows.length) {
      const unresolved = await db.query<{ id: string }>(
        `SELECT id FROM control_manual_investment_executions
         WHERE account_id = $1 AND status IN ('CLAIMED', 'SUBMITTED', 'UNKNOWN')
         LIMIT 1 FOR UPDATE`, [claim.accountId],
      );
      if (unresolved.rows.length) {
        throw new ManualBuyLedgerError("UNRESOLVED_TRADE", "An earlier trade is unresolved. Check its status before signing another.");
      }
      const signatureConflict = await db.query<{ id: string }>(
        `SELECT id FROM control_manual_investment_executions
         WHERE transaction_signature = $1 LIMIT 1 FOR UPDATE`, [claim.transactionSignature],
      );
      if (signatureConflict.rows.length) {
        throw new ManualBuyLedgerError("IDEMPOTENCY_CONFLICT", "This signed transaction was already claimed.");
      }
      throw new ManualBuyLedgerError("ORDER_EXPIRED", "This BUY order expired before submission.");
    }
    if (!matchesClaim(existing.rows[0], claim)) {
      throw new ManualBuyLedgerError("IDEMPOTENCY_CONFLICT", "The BUY order ID is already bound to a different transaction.");
    }
    return { claimed: false, record: normalize(existing.rows[0]) };
  });
}

export async function getManualBuyExecution(input: Omit<ManualBuyExecutionKey, "transactionSignature">,
  store: ControlStore = controlStore): Promise<ManualBuyExecutionRecord | null> {
  if (typeof input.accountId !== "string" || input.accountId.length < 3 || input.accountId.length > 128 ||
    typeof input.providerRequestId !== "string" || input.providerRequestId.length < 1 || input.providerRequestId.length > 256) return invalid();
  const result = await store.query<ExecutionRow>(
    `SELECT * FROM control_manual_investment_executions
     WHERE account_id = $1 AND wallet_address = $2 AND provider_request_id = $3`,
    [input.accountId, parseAddress(input.walletAddress), input.providerRequestId],
  );
  return result.rows.length ? normalize(result.rows[0]) : null;
}

/** Latest unresolved trade for this verified owner; never infer ownership from a request body. */
export async function getUnresolvedManualExecution(input: { accountId: string; walletAddress: string },
  store: ControlStore = controlStore): Promise<ManualBuyExecutionRecord | null> {
  if (typeof input.accountId !== "string" || input.accountId.length < 3 || input.accountId.length > 128) return invalid();
  const result = await store.query<ExecutionRow>(
    `SELECT * FROM control_manual_investment_executions
     WHERE account_id = $1 AND wallet_address = $2
       AND status IN ('CLAIMED', 'SUBMITTED', 'UNKNOWN')
     ORDER BY created_at DESC LIMIT 1`,
    [input.accountId, parseAddress(input.walletAddress)],
  );
  return result.rows.length ? normalize(result.rows[0]) : null;
}

export async function assertNoUnresolvedManualExecution(input: { accountId: string; walletAddress: string },
  store: ControlStore = controlStore): Promise<void> {
  if (await getUnresolvedManualExecution(input, store)) {
    throw new ManualBuyLedgerError("UNRESOLVED_TRADE", "An earlier trade is unresolved. Check its status before preparing another.");
  }
}

/** Recover an active order or a recent terminal result after a lost HTTP response. */
export async function getRecoverableManualExecution(input: { accountId: string; walletAddress: string },
  store: ControlStore = controlStore): Promise<ManualBuyExecutionRecord | null> {
  if (typeof input.accountId !== "string" || input.accountId.length < 3 || input.accountId.length > 128) return invalid();
  const result = await store.query<ExecutionRow>(
    `SELECT * FROM control_manual_investment_executions
     WHERE account_id = $1 AND wallet_address = $2
       AND (status IN ('CLAIMED', 'SUBMITTED', 'UNKNOWN')
         OR created_at >= now() - interval '24 hours')
     ORDER BY created_at DESC LIMIT 1`,
    [input.accountId, parseAddress(input.walletAddress)],
  );
  return result.rows.length ? normalize(result.rows[0]) : null;
}

async function lockedExecution(db: ControlQuery, key: ManualBuyExecutionKey): Promise<ExecutionRow> {
  const result = await db.query<ExecutionRow>(
    `SELECT * FROM control_manual_investment_executions
     WHERE account_id = $1 AND wallet_address = $2 AND provider_request_id = $3
       AND transaction_signature = $4 FOR UPDATE`,
    [key.accountId, key.walletAddress, key.providerRequestId, key.transactionSignature],
  );
  if (!result.rows.length) throw new ManualBuyLedgerError("NOT_FOUND", "Manual BUY execution was not found.");
  return result.rows[0];
}

async function transition(key: ManualBuyExecutionKey, next: "SUBMITTED" | "UNKNOWN",
  store: ControlStore): Promise<ManualBuyExecutionRecord> {
  const valid = validateKey(key);
  return store.transaction(async (db) => {
    const current = await lockedExecution(db, valid);
    if (current.status === next) return normalize(current);
    if (current.status !== "CLAIMED" && current.status !== (next === "SUBMITTED" ? "UNKNOWN" : "SUBMITTED")) {
      throw new ManualBuyLedgerError("INVALID_TRANSITION", "This BUY execution cannot change state.");
    }
    const changed = await db.query<ExecutionRow>(
      `UPDATE control_manual_investment_executions
       SET status = $2, submitted_at = CASE WHEN $2 = 'SUBMITTED' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
           updated_at = now()
       WHERE id = $1 RETURNING *`, [current.id, next],
    );
    await event(db, current.id, next);
    return normalize(changed.rows[0]);
  });
}

/** A provider acceptance is SUBMITTED, never proof of chain confirmation. */
export function markManualBuySubmitted(key: ManualBuyExecutionKey,
  store: ControlStore = controlStore): Promise<ManualBuyExecutionRecord> {
  return transition(key, "SUBMITTED", store);
}

/** Timeout, connection loss, or unknown provider outcome: do not submit again. */
export function markManualBuyUncertain(key: ManualBuyExecutionKey,
  store: ControlStore = controlStore): Promise<ManualBuyExecutionRecord> {
  return transition(key, "UNKNOWN", store);
}

/** Only the first submitter may record an explicit RPC preflight rejection. */
export async function markManualTradeRejected(key: ManualBuyExecutionKey,
  store: ControlStore = controlStore): Promise<ManualBuyExecutionRecord> {
  const valid = validateKey(key);
  return store.transaction(async (db) => {
    const current = await lockedExecution(db, valid);
    if (current.status === "REJECTED") return normalize(current);
    if (current.status !== "CLAIMED" || current.submitted_at !== null) {
      throw new ManualBuyLedgerError("INVALID_TRANSITION", "Only an unsubmitted claim can be rejected by preflight.");
    }
    const changed = await db.query<ExecutionRow>(
      `UPDATE control_manual_investment_executions
       SET status = 'REJECTED', resolved_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`, [current.id],
    );
    await event(db, current.id, "REJECTED");
    return normalize(changed.rows[0]);
  });
}

/** Call only after authoritative chain reconciliation, never on a timeout alone. */
export async function reconcileManualBuyExecution(input: ManualBuyExecutionKey & {
  outcome: "CONFIRMED" | "FAILED";
  actualInputAmountRaw?: string;
  actualOutputAmountRaw?: string;
  actualWalletNativeDebitLamportsRaw?: string;
}, store: ControlStore = controlStore): Promise<ManualBuyExecutionRecord> {
  const key = validateKey(input);
  if (input.outcome !== "CONFIRMED" && input.outcome !== "FAILED") return invalid();
  const actualInput = input.outcome === "CONFIRMED" ? rawAmount(input.actualInputAmountRaw ?? "") : null;
  const actualOutput = input.outcome === "CONFIRMED" ? rawAmount(input.actualOutputAmountRaw ?? "") : null;
  const actualNativeDebit = input.outcome === "CONFIRMED" ? rawAmount(input.actualWalletNativeDebitLamportsRaw ?? "") : null;
  if (input.outcome === "FAILED" && (input.actualInputAmountRaw !== undefined ||
    input.actualOutputAmountRaw !== undefined || input.actualWalletNativeDebitLamportsRaw !== undefined)) return invalid();
  return store.transaction(async (db) => {
    const current = await lockedExecution(db, key);
    if (actualInput !== null && BigInt(actualInput) > BigInt(current.input_amount_raw)) return invalid();
    if (actualOutput !== null && BigInt(actualOutput) < BigInt(current.required_minimum_output_raw)) return invalid();
    if (actualNativeDebit !== null && BigInt(actualNativeDebit) > BigInt(current.maximum_wallet_native_debit_lamports_raw)) return invalid();
    if (current.status === input.outcome) {
      if (current.actual_input_amount_raw !== actualInput || current.actual_output_amount_raw !== actualOutput ||
        current.actual_wallet_native_debit_lamports_raw !== actualNativeDebit) {
        throw new ManualBuyLedgerError("IDEMPOTENCY_CONFLICT", "The reconciled BUY result differs from the stored result.");
      }
      return normalize(current);
    }
    if (current.status === "CONFIRMED" || current.status === "FAILED" || current.status === "REJECTED") {
      throw new ManualBuyLedgerError("INVALID_TRANSITION", "The BUY execution is already resolved.");
    }
    const changed = await db.query<ExecutionRow>(
      `UPDATE control_manual_investment_executions
       SET status = $2, submitted_at = CASE WHEN $2 = 'CONFIRMED' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
           resolved_at = now(), updated_at = now(),
           actual_input_amount_raw = $3, actual_output_amount_raw = $4,
           actual_wallet_native_debit_lamports_raw = $5
       WHERE id = $1 RETURNING *`, [current.id, input.outcome, actualInput, actualOutput, actualNativeDebit],
    );
    await event(db, current.id, input.outcome);
    return normalize(changed.rows[0]);
  });
}
