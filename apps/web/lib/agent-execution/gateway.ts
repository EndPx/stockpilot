import "server-only";
import type { AgentPrincipal } from "@/lib/control-plane/credentials";
import {
  reserveAgentOperation, beginAgentOperationSigning, recordAgentOperationSigned,
  beginAgentOperationSubmission, rejectAgentOperationBeforeSigning, markAgentOperationUnknown,
  rejectAgentOperationBeforeSubmission, cancelOwnedAgentOperationReservation,
  reconcileAgentOperation, getAgentOperation, listAgentOperations,
  AgentOperationError,
  type AgentOperationRecord, type AgentOperationIntent, type AgentPreparedContext, type AgentOperationReconciliation,
} from "@/lib/control-plane/agent-operations";
import { getDelegatedSignerReadiness, signDelegatedTransaction } from "@/lib/privy/delegated-signer";
import { prepareDemoTrade, parseDemoTradeAmount, demoTradeProductSupported } from "@/lib/investments/demo-trade";
import { fingerprintTransactionMessage, assertSignedInvestmentTransaction, signedInvestmentSignature } from "@/lib/investments/authorization";
import { prepareTransfer, assertPreparedTransferTransaction, reconcileTransferOnChain, parseTransferAmount,
  type PreparedTransfer } from "@/lib/investments/transfer";
import { executeInvestment, getInvestmentBlockHeight } from "@/lib/investments/service";
import { reconcileManualBuyOnChain } from "@/lib/investments/reconciliation";
import { agentExecutionEnabled } from "./config";
import { readAgentOperationExpiry } from "./expiry";

export class AgentExecutionError extends Error {
  constructor(readonly code: "EXECUTION_DISABLED" | "OWNER_CONSENT_REQUIRED" | "INVALID_OPERATION" |
    "ASSET_NOT_ALLOWED" | "PREPARATION_FAILED" | "EXECUTION_UNAVAILABLE") {
    super(code);
    this.name = "AgentExecutionError";
  }
}
export type AgentExecutionRequest = { clientRequestId: string; amount: string } & (
  | { kind: "BUY" | "SELL"; assetId: string }
  | { kind: "TRANSFER_SOL" | "TRANSFER_USDC"; recipient: string }
);
type Dependencies = {
  enabled: typeof agentExecutionEnabled; now: () => number;
  readiness: typeof getDelegatedSignerReadiness; sign: typeof signDelegatedTransaction;
  reserve: typeof reserveAgentOperation; beginSigning: typeof beginAgentOperationSigning;
  recordSigned: typeof recordAgentOperationSigned; beginSubmission: typeof beginAgentOperationSubmission;
  reject: typeof rejectAgentOperationBeforeSigning; unknown: typeof markAgentOperationUnknown;
  rejectUnsubmitted: typeof rejectAgentOperationBeforeSubmission; cancelReserved: typeof cancelOwnedAgentOperationReservation;
  reconcile: typeof reconcileAgentOperation; get: typeof getAgentOperation; list: typeof listAgentOperations;
  prepareTrade: typeof prepareDemoTrade; prepareTransfer: typeof prepareTransfer;
  assertTransfer: typeof assertPreparedTransferTransaction;
  fingerprint: typeof fingerprintTransactionMessage; assertSigned: typeof assertSignedInvestmentTransaction;
  signature: typeof signedInvestmentSignature; blockHeight: typeof getInvestmentBlockHeight;
  execute: typeof executeInvestment; readTrade: typeof reconcileManualBuyOnChain;
  readTransfer: typeof reconcileTransferOnChain;
  readExpiry: typeof readAgentOperationExpiry;
};
const defaults: Dependencies = {
  enabled: agentExecutionEnabled, now: Date.now,
  readiness: getDelegatedSignerReadiness, sign: signDelegatedTransaction,
  reserve: reserveAgentOperation, beginSigning: beginAgentOperationSigning,
  recordSigned: recordAgentOperationSigned, beginSubmission: beginAgentOperationSubmission,
  reject: rejectAgentOperationBeforeSigning, unknown: markAgentOperationUnknown,
  rejectUnsubmitted: rejectAgentOperationBeforeSubmission, cancelReserved: cancelOwnedAgentOperationReservation,
  reconcile: reconcileAgentOperation, get: getAgentOperation, list: listAgentOperations,
  prepareTrade: prepareDemoTrade, prepareTransfer, assertTransfer: assertPreparedTransferTransaction,
  fingerprint: fingerprintTransactionMessage, assertSigned: assertSignedInvestmentTransaction,
  signature: signedInvestmentSignature, blockHeight: getInvestmentBlockHeight,
  execute: executeInvestment, readTrade: reconcileManualBuyOnChain, readTransfer: reconcileTransferOnChain,
  readExpiry: readAgentOperationExpiry,
};

/** Deliberate allowlist DTO: never return recovery bytes, authentication, or a signed wire. */
export function publicAgentOperation(operation: AgentOperationRecord) {
  return { operationId: operation.id, clientRequestId: operation.clientRequestId,
    kind: operation.kind, status: operation.status, amountRaw: operation.amountRaw,
    assetId: operation.assetId, recipient: operation.recipient, policyVersion: operation.policyVersion,
    signature: operation.transactionSignature,
    explorerUrl: operation.transactionSignature ? `https://solscan.io/tx/${operation.transactionSignature}` : null,
    actualInputAmountRaw: operation.actualInputAmountRaw, createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    note: operation.status === "EXPIRED" ? "Blockhash expired. Two RPCs found no landed transaction with historical coverage. This request is closed and was not retried. A new trade requires a new explicit request and clientRequestId." :
      ["CONFIRMED", "FAILED", "REJECTED"].includes(operation.status) ? null :
      "Unresolved. Reuse this clientRequestId or call get_operation; do not create a replacement trade or transfer." };
}

function tradeAsset(assetId: string) {
  const match = /^(prestocks|xstocks):([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(assetId);
  const provider = match?.[1] as "prestocks" | "xstocks" | undefined;
  if (!provider || !demoTradeProductSupported(provider, match![2])) throw new AgentExecutionError("ASSET_NOT_ALLOWED");
  return { provider, mintAddress: match![2], decimals: provider === "prestocks" ? 9 : 8 };
}

export function agentOperationIntent(request: AgentExecutionRequest): AgentOperationIntent {
  if (!request || !/^[A-Za-z0-9_-]{16,128}$/.test(request.clientRequestId) ||
    typeof request.amount !== "string" || request.amount.length > 40) throw new AgentExecutionError("INVALID_OPERATION");
  if (request.kind === "BUY" || request.kind === "SELL") {
    const asset = tradeAsset(request.assetId);
    return { kind: request.kind, clientRequestId: request.clientRequestId, assetId: request.assetId,
      amountRaw: parseDemoTradeAmount(request.amount, request.kind === "BUY" ? 6 : asset.decimals).toString() };
  }
  if (request.kind !== "TRANSFER_SOL" && request.kind !== "TRANSFER_USDC") throw new AgentExecutionError("INVALID_OPERATION");
  return { kind: request.kind, clientRequestId: request.clientRequestId, recipient: request.recipient,
    amountRaw: parseTransferAmount(request.amount, request.kind === "TRANSFER_SOL" ? 9 : 6).toString() };
}

function recoverTransfer(operation: AgentOperationRecord): PreparedTransfer {
  const context = operation.preparedContext;
  if (!context?.transfer || !operation.recipient || !operation.providerRequestId || !operation.messageFingerprint) {
    throw new AgentExecutionError("EXECUTION_UNAVAILABLE");
  }
  return { ...context.transfer, transaction: context.transaction, expiresAt: context.expiresAt,
    lastValidBlockHeight: context.lastValidBlockHeight,
    maximumNativeDebitLamportsRaw: context.maximumWalletNativeDebitLamportsRaw,
    walletAddress: operation.walletAddress, recipient: operation.recipient, inputAmountRaw: operation.amountRaw,
    requestId: operation.providerRequestId, messageFingerprint: operation.messageFingerprint };
}

/** Shared read-only evidence path for MCP and explicit operator recovery. */
export async function readAgentOperationResolution(operation: AgentOperationRecord,
  deps: Pick<Dependencies, "readTrade" | "readTransfer" | "readExpiry"> = defaults): Promise<AgentOperationReconciliation | null> {
    if (!operation.transactionSignature || !operation.preparedContext ||
      ["CONFIRMED", "FAILED", "REJECTED", "EXPIRED"].includes(operation.status)) return null;
    const context = operation.preparedContext;
    try {
      let chain: Awaited<ReturnType<typeof reconcileManualBuyOnChain>> | Awaited<ReturnType<typeof reconcileTransferOnChain>>;
      if (operation.kind === "BUY" || operation.kind === "SELL") {
        if (!context.inputMint || !context.outputMint || context.inputDecimals === undefined ||
          context.outputDecimals === undefined || !context.requiredMinimumOutputRaw) return null;
        chain = await deps.readTrade({ side: operation.kind, signature: operation.transactionSignature,
          walletAddress: operation.walletAddress, inputMint: context.inputMint, outputMint: context.outputMint,
          inputDecimals: context.inputDecimals, outputDecimals: context.outputDecimals,
          expectedInputAmountRaw: operation.amountRaw, requiredMinimumOutputRaw: context.requiredMinimumOutputRaw,
          maximumWalletNativeDebitLamportsRaw: context.maximumWalletNativeDebitLamportsRaw });
      } else {
        chain = await deps.readTransfer({ prepared: recoverTransfer(operation), signature: operation.transactionSignature });
      }
      if (chain.status !== "PENDING") return {
        outcome: chain.status, evidence: chain.status === "CONFIRMED" ? "FINALIZED_SUCCESS" : "FINALIZED_FAILURE",
        ...(chain.status === "CONFIRMED" ? { actualInputAmountRaw: chain.actualInputAmountRaw } : {}),
      };
      const expiryEvidence = await deps.readExpiry(operation);
      if (expiryEvidence) return { outcome: "EXPIRED", evidence: "EXPIRED_UNLANDED_QUORUM", expiryEvidence };
    } catch { /* Missing/mismatched chain evidence cannot release the reserved budget. */ }
    return null;
}

/** Only this invocation's successful durable claim can sign and submit. Every retry is read-only. */
export function createAgentExecutionGateway(overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  async function reconcile(principal: AgentPrincipal, operation: AgentOperationRecord): Promise<AgentOperationRecord> {
    const result = await readAgentOperationResolution(operation, deps);
    if (!result) return operation;
    try { return await deps.reconcile(principal, operation.id, result); }
    catch { return operation; /* Concurrent settlement/revocation cannot authorize a second send. */ }
  }

  return {
    async get(principal: AgentPrincipal, id: string) {
      return publicAgentOperation(await reconcile(principal, await deps.get(principal, id)));
    },
    async list(principal: AgentPrincipal, limit = 25) {
      const operations = await deps.list(principal, { limit });
      // The ledger permits only one unresolved operation per wallet; refreshing
      // the list can reconcile it too, without any signing or submission.
      return { operations: await Promise.all(operations.map(async operation =>
        publicAgentOperation(await reconcile(principal, operation)))) };
    },
    async execute(principal: AgentPrincipal, request: AgentExecutionRequest) {
      if (!deps.enabled()) throw new AgentExecutionError("EXECUTION_DISABLED");
      const intent = agentOperationIntent(request);
      const identity = { privyUserId: principal.accountId, walletAddress: principal.walletAddress };
      const reservation = await deps.reserve(principal, intent);
      if (!reservation.created) return publicAgentOperation(await reconcile(principal, reservation.operation));
      let operation = reservation.operation;
      let context: AgentPreparedContext;
      let providerRequestId: string;
      let fingerprint: string;
      try {
        if (!(await deps.readiness(identity)).ready) throw new AgentExecutionError("OWNER_CONSENT_REQUIRED");
        if (request.kind === "BUY" || request.kind === "SELL") {
          const asset = tradeAsset(request.assetId);
          // reserve() already required the owner's durable country/non-US/terms assertion.
          const { prepared, review } = await deps.prepareTrade(identity.walletAddress, identity.privyUserId, {
            side: request.kind, provider: asset.provider, mintAddress: asset.mintAddress,
            amount: request.amount, eligibleNonUsAttestation: true,
          });
          if (review.inputAmountRaw !== intent.amountRaw) throw new AgentExecutionError("PREPARATION_FAILED");
          providerRequestId = prepared.requestId;
          context = { transaction: prepared.transaction, expiresAt: review.expiresAt,
            lastValidBlockHeight: prepared.lastValidBlockHeight!,
            maximumWalletNativeDebitLamportsRaw: review.maximumWalletNativeDebitLamportsRaw,
            inputMint: review.inputMint, outputMint: review.outputMint,
            inputDecimals: request.kind === "BUY" ? 6 : asset.decimals,
            outputDecimals: request.kind === "BUY" ? asset.decimals : 6,
            requiredMinimumOutputRaw: review.requiredMinimumOutputRaw };
        } else if (request.kind === "TRANSFER_SOL" || request.kind === "TRANSFER_USDC") {
          const prepared = await deps.prepareTransfer({ kind: request.kind === "TRANSFER_SOL" ? "SOL" : "USDC",
            walletAddress: identity.walletAddress, recipient: request.recipient, amount: request.amount });
          await deps.assertTransfer(prepared);
          if (prepared.inputAmountRaw !== intent.amountRaw || prepared.recipient !== intent.recipient ||
            prepared.walletAddress !== identity.walletAddress) throw new AgentExecutionError("PREPARATION_FAILED");
          providerRequestId = prepared.requestId;
          context = { transaction: prepared.transaction, expiresAt: prepared.expiresAt,
            lastValidBlockHeight: prepared.lastValidBlockHeight,
            maximumWalletNativeDebitLamportsRaw: prepared.maximumNativeDebitLamportsRaw,
            transfer: { kind: prepared.kind, blockhash: prepared.blockhash, mint: prepared.mint,
              decimals: prepared.decimals, networkFeeLamportsRaw: prepared.networkFeeLamportsRaw,
              accountRentLamportsRaw: prepared.accountRentLamportsRaw, sourceTokenAccount: prepared.sourceTokenAccount,
              destinationAccount: prepared.destinationAccount, createDestinationAta: prepared.createDestinationAta } };
        } else { throw new AgentExecutionError("INVALID_OPERATION"); }
        fingerprint = await deps.fingerprint(context.transaction);
      } catch (error) {
        // No signing attempt occurred. Only the still-RESERVED row may be rejected.
        await deps.cancelReserved(identity, principal.clientId, operation.id);
        throw error;
      }
      let signingClaimed = false;
      try {
        const signing = await deps.beginSigning(principal, operation.id, {
          providerRequestId, messageFingerprint: fingerprint, preparedContext: context,
        });
        operation = signing.operation;
        if (!signing.claimed) return publicAgentOperation(await reconcile(principal, operation));
        signingClaimed = true;
        const signed = await deps.sign(identity, { transaction: context.transaction,
          idempotencyKey: `stockpilot:${operation.id}`, expiresAtMs: Date.parse(context.expiresAt) });
        await deps.assertSigned(signed, identity.walletAddress, fingerprint);
        const signature = deps.signature(signed, identity.walletAddress);
        operation = await deps.recordSigned(principal, operation.id, { transactionSignature: signature });
        // Re-read delegation and kill switch immediately before the durable send fence.
        try {
          if (!deps.enabled() || !(await deps.readiness(identity)).ready || deps.now() >= Date.parse(context.expiresAt) ||
            await deps.blockHeight() > BigInt(context.lastValidBlockHeight)) throw new AgentExecutionError("EXECUTION_UNAVAILABLE");
        } catch {
          // The send fence has not been attempted, so this signed message cannot have been submitted here.
          operation = await deps.rejectUnsubmitted(principal, operation.id);
          return publicAgentOperation(operation);
        }
        const submission = await deps.beginSubmission(principal, operation.id);
        operation = submission.operation;
        if (!submission.claimed) return publicAgentOperation(await reconcile(principal, operation));
        // There is exactly one send attempt. Never return or persist the signed bytes.
        const sent = await deps.execute({ signedTransaction: signed, requestId: providerRequestId,
          lastValidBlockHeight: context.lastValidBlockHeight });
        if (sent.status === "Rejected") {
          operation = await deps.reconcile(principal, operation.id, { outcome: "REJECTED", evidence: "RPC_PREFLIGHT_REJECTED" });
        } else if (sent.status !== "Success" || sent.signature !== signature) {
          operation = await deps.unknown(principal, operation.id);
        }
      } catch (error) {
        if (!signingClaimed && error instanceof AgentOperationError &&
          ["POLICY_DISABLED", "POLICY_EXPIRED", "POLICY_VERSION_MISMATCH", "POLICY_LIMIT",
            "ASSET_NOT_ALLOWED", "RECIPIENT_NOT_ALLOWED", "ELIGIBILITY_REQUIRED", "INVALID_INPUT", "IDEMPOTENCY_CONFLICT"].includes(error.code)) {
          // A typed validation denial before the signing claim is not an ambiguous DB response.
          // The store only releases RESERVED, so a concurrent/committed signing claim still wins.
          operation = await deps.reject(principal, operation.id);
          return publicAgentOperation(operation);
        }
        // Signing/provider/database uncertainty never means safe to create another operation.
        try { operation = await deps.unknown(principal, operation.id); } catch { /* durable prior claim remains */ }
      }
      return publicAgentOperation(await reconcile(principal, operation));
    },
  };
}

export const agentExecutionGateway = createAgentExecutionGateway();
