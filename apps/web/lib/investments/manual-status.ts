import "server-only";

import type { ControlIdentity } from "@/lib/control-plane/clients";
import {
  getManualBuyExecution,
  getRecoverableManualExecution,
  reconcileManualBuyExecution,
  type ManualBuyExecutionKey,
  type ManualBuyExecutionRecord,
  type ManualBuyStatus,
} from "@/lib/control-plane/manual-executions";
import {
  reconcileManualBuyOnChain,
  SolanaBuyReconciliationError,
  type ManualBuyReconciliation,
  type ManualBuyReconciliationInput,
} from "./reconciliation";

type Settlement = ManualBuyExecutionKey & {
  outcome: "CONFIRMED" | "FAILED";
  actualInputAmountRaw?: string;
  actualOutputAmountRaw?: string;
  actualWalletNativeDebitLamportsRaw?: string;
};

export type ManualBuyStatusDependencies = {
  getExecution: (key: Omit<ManualBuyExecutionKey, "transactionSignature">) => Promise<ManualBuyExecutionRecord | null>;
  reconcileOnChain: (input: ManualBuyReconciliationInput) => Promise<ManualBuyReconciliation>;
  settleExecution: (input: Settlement) => Promise<ManualBuyExecutionRecord>;
};

const defaults: ManualBuyStatusDependencies = {
  getExecution: getManualBuyExecution,
  reconcileOnChain: reconcileManualBuyOnChain,
  settleExecution: reconcileManualBuyExecution,
};

export type ManualBuyStatusView = {
  side?: "BUY" | "SELL";
  providerRequestId: string;
  transactionSignature: string;
  status: ManualBuyStatus | "REVIEW_REQUIRED";
  ledgerStatus: ManualBuyStatus;
  actualInputAmountRaw: string | null;
  actualOutputAmountRaw: string | null;
  actualWalletNativeDebitLamportsRaw: string | null;
};

function view(record: ManualBuyExecutionRecord, status: ManualBuyStatusView["status"] = record.status): ManualBuyStatusView {
  return {
    ...(record.side === "SELL" ? { side: "SELL" as const } : {}),
    providerRequestId: record.providerRequestId,
    transactionSignature: record.transactionSignature,
    status,
    ledgerStatus: record.status,
    actualInputAmountRaw: record.actualInputAmountRaw,
    actualOutputAmountRaw: record.actualOutputAmountRaw,
    actualWalletNativeDebitLamportsRaw: record.actualWalletNativeDebitLamportsRaw,
  };
}

/**
 * Rechecks a previously claimed BUY or SELL without a quote or authorization token.
 * This service never signs, submits, or retries a transaction. The caller must
 * supply an identity derived from a verified Privy session, not request data.
 */
export async function readManualBuyStatus(
  owner: ControlIdentity,
  providerRequestId: string,
  dependencies: ManualBuyStatusDependencies = defaults,
): Promise<ManualBuyStatusView | null> {
  const key = { accountId: owner.privyUserId, walletAddress: owner.walletAddress, providerRequestId };
  const record = await dependencies.getExecution(key);
  if (!record) return null;
  if (record.accountId !== key.accountId || record.walletAddress !== key.walletAddress ||
    record.providerRequestId !== key.providerRequestId) {
    throw new Error("Manual trade owner binding mismatch.");
  }
  if (record.status === "CONFIRMED" || record.status === "FAILED" || record.status === "REJECTED") return view(record);

  let chain: ManualBuyReconciliation;
  try {
    chain = await dependencies.reconcileOnChain({
      side: record.side,
      signature: record.transactionSignature,
      walletAddress: record.walletAddress,
      inputMint: record.inputMint,
      outputMint: record.outputMint,
      inputDecimals: record.inputDecimals,
      expectedInputAmountRaw: record.inputAmountRaw,
      requiredMinimumOutputRaw: record.requiredMinimumOutputRaw,
      maximumWalletNativeDebitLamportsRaw: record.maximumWalletNativeDebitLamportsRaw,
      outputDecimals: record.outputDecimals,
    });
  } catch (error) {
    // A finalized but semantically invalid transaction and an unavailable RPC
    // are both unverified. Neither is proof of failure or permission to retry.
    if (error instanceof SolanaBuyReconciliationError) return view(record, "REVIEW_REQUIRED");
    throw error;
  }
  if (chain.status === "PENDING") return view(record);

  const settlement: Settlement = {
    accountId: record.accountId,
    walletAddress: record.walletAddress,
    providerRequestId: record.providerRequestId,
    transactionSignature: record.transactionSignature,
    outcome: chain.status,
  };
  if (chain.status === "CONFIRMED") {
    // These are defense-in-depth checks; the chain verifier and durable ledger
    // also enforce the immutable, order-bound limits.
    if (BigInt(chain.actualInputAmountRaw) <= 0n ||
      BigInt(chain.actualInputAmountRaw) > BigInt(record.inputAmountRaw) ||
      BigInt(chain.actualOutputAmountRaw) < BigInt(record.requiredMinimumOutputRaw) ||
      BigInt(chain.actualWalletNativeDebitLamportsRaw) > BigInt(record.maximumWalletNativeDebitLamportsRaw)) {
      return view(record, "REVIEW_REQUIRED");
    }
    settlement.actualInputAmountRaw = chain.actualInputAmountRaw;
    settlement.actualOutputAmountRaw = chain.actualOutputAmountRaw;
    settlement.actualWalletNativeDebitLamportsRaw = chain.actualWalletNativeDebitLamportsRaw;
  }
  return view(await dependencies.settleExecution(settlement));
}

export const readManualTradeStatus = readManualBuyStatus;

/** Recover an unresolved or recent terminal trade after a lost response/page reload. */
export async function readRecoverableManualTradeStatus(
  owner: ControlIdentity,
  find: typeof getRecoverableManualExecution = getRecoverableManualExecution,
  dependencies: ManualBuyStatusDependencies = defaults,
): Promise<ManualBuyStatusView | null> {
  const record = await find({ accountId: owner.privyUserId, walletAddress: owner.walletAddress });
  return record ? readManualBuyStatus(owner, record.providerRequestId, dependencies) : null;
}
