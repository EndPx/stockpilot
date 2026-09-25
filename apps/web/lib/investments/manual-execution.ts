import "server-only";

import {
  claimManualBuyExecution,
  markManualBuySubmitted,
  markManualBuyUncertain,
  markManualTradeRejected,
  reconcileManualBuyExecution,
  type ManualBuyExecutionKey,
  type ManualBuyExecutionRecord,
} from "@/lib/control-plane/manual-executions";
import {
  assertAuthorizationWallet,
  assertOrderStillValid,
  assertSignedInvestmentTransaction,
  signedInvestmentSignature,
  type InvestmentAuthorization,
} from "./authorization";
import { executeInvestment, getInvestmentBlockHeight } from "./service";
import { reconcileManualBuyOnChain } from "./reconciliation";

export type ManualBuyOutcome =
  | { status: "PENDING"; requestId: string; signature: string; side?: "BUY" | "SELL" }
  | { status: "FAILED"; requestId: string; signature: string; side?: "BUY" | "SELL" }
  | { status: "REJECTED"; requestId: string; signature: string; side?: "BUY" | "SELL" }
  | { status: "CONFIRMED"; requestId: string; signature: string; side?: "BUY" | "SELL"; actualInputAmountRaw: string; actualOutputAmountRaw: string };

export type ManualBuyInput = {
  /** Must come from the active server-verified Privy session, never the request body. */
  accountId: string;
  walletAddress: string;
  authorization: InvestmentAuthorization;
  signedTransaction: string;
};

type Dependencies = {
  now: () => number;
  blockHeight: typeof getInvestmentBlockHeight;
  assertSigned: typeof assertSignedInvestmentTransaction;
  signature: typeof signedInvestmentSignature;
  claim: typeof claimManualBuyExecution;
  markSubmitted: typeof markManualBuySubmitted;
  markUncertain: typeof markManualBuyUncertain;
  markRejected: typeof markManualTradeRejected;
  settle: typeof reconcileManualBuyExecution;
  readChain: typeof reconcileManualBuyOnChain;
  execute: typeof executeInvestment;
};

const defaults: Dependencies = {
  now: Date.now,
  blockHeight: getInvestmentBlockHeight,
  assertSigned: assertSignedInvestmentTransaction,
  signature: signedInvestmentSignature,
  claim: claimManualBuyExecution,
  markSubmitted: markManualBuySubmitted,
  markUncertain: markManualBuyUncertain,
  markRejected: markManualTradeRejected,
  settle: reconcileManualBuyExecution,
  readChain: reconcileManualBuyOnChain,
  execute: executeInvestment,
};

function terminal(record: ManualBuyExecutionRecord): ManualBuyOutcome | null {
  const common = { requestId: record.providerRequestId, signature: record.transactionSignature,
    ...(record.side === "SELL" ? { side: "SELL" as const } : {}) };
  if (record.status === "FAILED") return { status: "FAILED", ...common };
  if (record.status === "REJECTED") return { status: "REJECTED", ...common };
  if (record.status === "CONFIRMED" && record.actualInputAmountRaw && record.actualOutputAmountRaw) {
    return { status: "CONFIRMED", ...common,
      actualInputAmountRaw: record.actualInputAmountRaw,
      actualOutputAmountRaw: record.actualOutputAmountRaw };
  }
  return null;
}

/**
 * One signed BUY or SELL Jupiter order may cross the provider boundary only after an atomic,
 * durable claim. A duplicate call is read-only, including after timeout/restart.
 * Provider success is not chain confirmation; only finalized Solana evidence is.
 */
export async function executeManualBuyOnce(input: ManualBuyInput,
  dependencies: Partial<Dependencies> = {}): Promise<ManualBuyOutcome> {
  const deps = { ...defaults, ...dependencies };
  const authorization = input.authorization;
  if (!input.accountId || authorization.expiresAt <= deps.now()) {
    throw new Error("Manual BUY authorization is unavailable or expired.");
  }
  if (authorization.maximumWalletNativeDebitLamportsRaw === null || authorization.requiredMinimumOutputRaw === null) {
    throw new Error("Manual BUY transaction-effect authorization is unavailable.");
  }
  assertAuthorizationWallet(authorization, input.walletAddress);
  const currentBlockHeight = authorization.lastValidBlockHeight === null ? null : await deps.blockHeight();
  assertOrderStillValid(authorization, currentBlockHeight, deps.now());
  await deps.assertSigned(input.signedTransaction, input.walletAddress, authorization.messageFingerprint);
  const signature = deps.signature(input.signedTransaction, input.walletAddress);
  const key: ManualBuyExecutionKey = {
    accountId: input.accountId,
    walletAddress: input.walletAddress,
    providerRequestId: authorization.requestId,
    transactionSignature: signature,
  };
  const claim = await deps.claim({
    ...key,
    side: authorization.side ?? "BUY",
    messageFingerprint: authorization.messageFingerprint,
    inputMint: authorization.inputMint,
    outputMint: authorization.outputMint,
    inputDecimals: authorization.inputDecimals ?? 6,
    inputAmountRaw: authorization.inputAmountRaw,
    outputDecimals: authorization.outputDecimals,
    requiredMinimumOutputRaw: authorization.requiredMinimumOutputRaw,
    maximumWalletNativeDebitLamportsRaw: authorization.maximumWalletNativeDebitLamportsRaw,
    expiresAt: new Date(authorization.expiresAt).toISOString(),
  });
  const previous = terminal(claim.record);
  if (previous) return previous;

  if (claim.claimed) {
    let providerResult: Awaited<ReturnType<typeof executeInvestment>> | undefined;
    try {
      providerResult = await deps.execute({
        signedTransaction: input.signedTransaction,
        requestId: authorization.requestId,
        ...(authorization.lastValidBlockHeight ? { lastValidBlockHeight: authorization.lastValidBlockHeight } : {}),
      });
    } catch {
      // A timeout or dropped response can still mean the provider received the wire bytes.
    }
    try {
      if (providerResult?.status === "Rejected") {
        const result = terminal(await deps.markRejected(key));
        if (result) return result;
      } else if (providerResult?.status === "Success" && providerResult.signature === signature) {
        await deps.markSubmitted(key);
      } else {
        await deps.markUncertain(key);
      }
    } catch {
      // The durable claim already prevents replay; reconciliation remains read-only.
    }
  }

  try {
    const chain = await deps.readChain({
      side: authorization.side ?? "BUY",
      signature,
      walletAddress: input.walletAddress,
      inputMint: authorization.inputMint,
      outputMint: authorization.outputMint,
      inputDecimals: authorization.inputDecimals ?? 6,
      expectedInputAmountRaw: authorization.inputAmountRaw,
      requiredMinimumOutputRaw: authorization.requiredMinimumOutputRaw,
      maximumWalletNativeDebitLamportsRaw: authorization.maximumWalletNativeDebitLamportsRaw,
      outputDecimals: authorization.outputDecimals,
    });
    if (chain.status === "CONFIRMED") {
      if (BigInt(chain.actualOutputAmountRaw) < BigInt(authorization.requiredMinimumOutputRaw)) {
        // An on-chain success below the authorized floor requires incident review;
        // it is neither a failed transaction nor a compliant confirmed BUY.
        return { status: "PENDING", requestId: authorization.requestId, signature,
          ...(authorization.side === "SELL" ? { side: "SELL" as const } : {}) };
      }
      const record = await deps.settle({ ...key, outcome: "CONFIRMED",
        actualInputAmountRaw: chain.actualInputAmountRaw,
        actualOutputAmountRaw: chain.actualOutputAmountRaw,
        actualWalletNativeDebitLamportsRaw: chain.actualWalletNativeDebitLamportsRaw });
      const result = terminal(record);
      if (result) return result;
    }
    if (chain.status === "FAILED") {
      const record = await deps.settle({ ...key, outcome: "FAILED" });
      const result = terminal(record);
      if (result) return result;
    }
  } catch {
    // Never label a provider/RPC/ledger failure as a failed on-chain transaction.
  }
  return { status: "PENDING", requestId: authorization.requestId, signature,
    ...(authorization.side === "SELL" ? { side: "SELL" as const } : {}) };
}

/** Both directions use the same owner-bound, one-submit ledger. */
export const executeManualTradeOnce = executeManualBuyOnce;
