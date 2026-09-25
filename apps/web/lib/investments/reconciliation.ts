import "server-only";

import { address, createSolanaRpc, mainnet } from "@solana/kit";
import {
  SOLANA_MAINNET_USDC_DECIMALS,
  SOLANA_MAINNET_USDC_MINT,
  SPL_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@stockpilot/core/solana";
import { getSolanaRpcUrl } from "../solana/read-adapter";

type RpcRequest = { send(options?: { abortSignal?: AbortSignal }): Promise<unknown> };

export type SolanaBuyReconciliationRpc = {
  getSignatureStatuses(signatures: unknown, config: { searchTransactionHistory: true }): RpcRequest;
  getTransaction(signature: unknown, config: {
    commitment: "finalized";
    encoding: "json";
    maxSupportedTransactionVersion: 0;
  }): RpcRequest;
};

export type ManualBuyReconciliationInput = {
  side?: "BUY" | "SELL";
  signature: string;
  walletAddress: string;
  inputMint: string;
  outputMint: string;
  inputDecimals?: number;
  expectedInputAmountRaw: string;
  requiredMinimumOutputRaw: string;
  /** Signed, order-bound cap for network fee and approved account rent. No default. */
  maximumWalletNativeDebitLamportsRaw: string;
  outputDecimals: number;
};

export type ManualBuyReconciliation =
  | { status: "PENDING" }
  | { status: "FAILED"; slot: number }
  | { status: "CONFIRMED"; slot: number; actualInputAmountRaw: string; actualOutputAmountRaw: string;
      actualWalletNativeDebitLamportsRaw: string };

export class SolanaBuyReconciliationError extends Error {
  constructor(options?: ErrorOptions) {
    super("Solana could not verify this BUY transaction; keep it unresolved.", options);
    this.name = "SolanaBuyReconciliationError";
  }
}

const MAX_U64 = 18_446_744_073_709_551_615n;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{80,88}$/;
const TOKEN_PROGRAMS = new Set([SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS]);

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function invalid(): never {
  throw new SolanaBuyReconciliationError();
}

function parsedAddress(value: unknown): string {
  if (typeof value !== "string") return invalid();
  try { return address(value).toString(); } catch { return invalid(); }
}

function rawAmount(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 20 || !/^\d+$/.test(value)) return invalid();
  const parsed = BigInt(value);
  if (parsed > MAX_U64) return invalid();
  return parsed;
}

function lamports(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n && value <= MAX_U64) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return invalid();
}

function safeSlot(value: unknown): number {
  // @solana/kit materializes Slot as bigint, while a mocked/raw JSON-RPC
  // response may still carry a JSON number. Keep the API JSON-serializable.
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}

type ValidatedInput = ManualBuyReconciliationInput & {
  side: "BUY" | "SELL";
  inputDecimals: number;
  expectedInputRaw: bigint;
  minimumOutputRaw: bigint;
  maximumWalletNativeDebitLamports: bigint;
};

function validate(input: ManualBuyReconciliationInput): ValidatedInput {
  if (typeof input.signature !== "string" || !SIGNATURE_PATTERN.test(input.signature) ||
    !Number.isInteger(input.outputDecimals) || input.outputDecimals < 0 || input.outputDecimals > 255) return invalid();
  const walletAddress = parsedAddress(input.walletAddress);
  const inputMint = parsedAddress(input.inputMint);
  const outputMint = parsedAddress(input.outputMint);
  const side = input.side ?? "BUY";
  const inputDecimals = input.inputDecimals ?? (side === "BUY" ? SOLANA_MAINNET_USDC_DECIMALS : -1);
  if ((side !== "BUY" && side !== "SELL") ||
    (side === "BUY" ? inputMint !== SOLANA_MAINNET_USDC_MINT || inputDecimals !== SOLANA_MAINNET_USDC_DECIMALS
      : outputMint !== SOLANA_MAINNET_USDC_MINT || input.outputDecimals !== SOLANA_MAINNET_USDC_DECIMALS ||
        inputMint === SOLANA_MAINNET_USDC_MINT) ||
    inputMint === outputMint || !Number.isInteger(inputDecimals) || inputDecimals < 0 || inputDecimals > 255) return invalid();
  const expectedInputRaw = rawAmount(input.expectedInputAmountRaw);
  const minimumOutputRaw = rawAmount(input.requiredMinimumOutputRaw);
  const maximumWalletNativeDebitLamports = rawAmount(input.maximumWalletNativeDebitLamportsRaw);
  if (expectedInputRaw <= 0n || minimumOutputRaw <= 0n || maximumWalletNativeDebitLamports <= 0n) return invalid();
  return { ...input, side, inputDecimals, walletAddress, inputMint, outputMint, expectedInputRaw,
    minimumOutputRaw, maximumWalletNativeDebitLamports };
}

function statusSlot(response: unknown): { slot: number; failed: boolean } | null {
  const result = object(response);
  // Solana's getSignatureStatuses result is { value: [status | null] }.
  if (!result || !Array.isArray(result.value) || result.value.length !== 1) return invalid();
  const status = result.value[0];
  if (status === null) return null;
  const row = object(status);
  if (!row || !Object.hasOwn(row, "err")) return invalid();
  if (row.confirmationStatus !== "finalized") return null;
  return { slot: safeSlot(row.slot), failed: row.err !== null };
}

type BalanceEntry = {
  accountIndex: number;
  mint: string;
  owner: string;
  programId: string;
  amount: bigint;
  decimals: number;
};

function balanceEntries(value: unknown, accountKeys: string[]): Map<number, BalanceEntry> {
  if (!Array.isArray(value)) return invalid();
  const result = new Map<number, BalanceEntry>();
  for (const raw of value) {
    const entry = object(raw);
    const ui = object(entry?.uiTokenAmount);
    if (!entry || !ui || !Number.isInteger(entry.accountIndex) ||
      (entry.accountIndex as number) < 0 || (entry.accountIndex as number) >= accountKeys.length ||
      !Number.isInteger(ui.decimals) || (ui.decimals as number) < 0 || (ui.decimals as number) > 255) return invalid();
    const accountIndex = entry.accountIndex as number;
    if (result.has(accountIndex)) return invalid();
    const programId = parsedAddress(entry.programId);
    if (!TOKEN_PROGRAMS.has(programId)) return invalid();
    result.set(accountIndex, {
      accountIndex, mint: parsedAddress(entry.mint), owner: parsedAddress(entry.owner),
      programId, amount: rawAmount(ui.amount), decimals: ui.decimals as number,
    });
  }
  return result;
}

function transactionData(response: unknown, input: ValidatedInput, status: { slot: number; failed: boolean }):
  ManualBuyReconciliation {
  const result = object(response);
  const transaction = object(result?.transaction);
  const message = object(transaction?.message);
  const header = object(message?.header);
  const meta = object(result?.meta);
  if (!result || !transaction || !message || !header || !meta || result.version !== 0 ||
    !Array.isArray(transaction.signatures) || transaction.signatures.length !== 1 ||
    transaction.signatures[0] !== input.signature ||
    !Array.isArray(message.accountKeys) || !Array.isArray(meta.preTokenBalances) ||
    !Array.isArray(meta.postTokenBalances) || !Array.isArray(meta.preBalances) ||
    !Array.isArray(meta.postBalances) || safeSlot(result.slot) !== status.slot) return invalid();
  const keys = message.accountKeys.map(parsedAddress);
  const signers = header.numRequiredSignatures;
  if (signers !== 1 || keys[0] !== input.walletAddress) return invalid();
  const loaded = object(meta.loadedAddresses);
  if (!loaded || !Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly)) return invalid();
  const accountKeys = [...keys, ...loaded.writable.map(parsedAddress), ...loaded.readonly.map(parsedAddress)];
  if (meta.preBalances.length !== accountKeys.length || meta.postBalances.length !== accountKeys.length) return invalid();
  const beforeLamports = meta.preBalances.map(lamports);
  const afterLamports = meta.postBalances.map(lamports);
  const fee = lamports(meta.fee);
  const nativeDebit = beforeLamports[0] - afterLamports[0];
  // Bound the observable net SOL loss and reject credits that offset even the
  // fee. A balanced drain and credit can still hide in net balances; only the
  // separate pre-sign instruction verifier can rule out that pattern.
  // This cap also applies when the transaction failed on chain.
  if (fee <= 0n || fee > input.maximumWalletNativeDebitLamports ||
    nativeDebit < fee || nativeDebit > input.maximumWalletNativeDebitLamports) return invalid();
  if (!Object.hasOwn(meta, "err") || (meta.err !== null) !== status.failed) return invalid();
  if (status.failed) return { status: "FAILED", slot: status.slot };

  const pre = balanceEntries(meta.preTokenBalances, accountKeys);
  const post = balanceEntries(meta.postTokenBalances, accountKeys);
  let inputDelta = 0n;
  let grossInputDebit = 0n;
  let outputDelta = 0n;
  let hasInput = false;
  let hasOutput = false;
  for (const index of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(index);
    const after = post.get(index);
    // The only unambiguous one-sided token balance is account creation or
    // closure. An existing account whose token metadata vanished is not 0.
    if ((!before && after && beforeLamports[index] !== 0n) ||
      (before && !after && afterLamports[index] !== 0n)) return invalid();
    if (before && after && (before.mint !== after.mint || before.owner !== after.owner ||
      before.programId !== after.programId || before.decimals !== after.decimals)) return invalid();
    const entry = before ?? after;
    if (!entry || entry.owner !== input.walletAddress) continue;
    const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n);
    if (entry.mint === input.inputMint) {
      if (entry.decimals !== input.inputDecimals ||
        (input.side === "BUY" && entry.programId !== SPL_TOKEN_PROGRAM_ADDRESS)) return invalid();
      hasInput = true;
      inputDelta += delta;
      if (delta < 0n) grossInputDebit -= delta;
    } else if (entry.mint === input.outputMint) {
      if (entry.decimals !== input.outputDecimals ||
        (input.side === "SELL" && entry.programId !== SPL_TOKEN_PROGRAM_ADDRESS)) return invalid();
      if (delta < 0n) return invalid();
      hasOutput = true;
      outputDelta += delta;
    } else if (delta !== 0n) {
      // A wallet-owned third-token movement is outside this exact trade.
      return invalid();
    }
  }
  const actualInput = -inputDelta;
  if (!hasInput || !hasOutput || actualInput <= 0n || grossInputDebit > input.expectedInputRaw ||
    outputDelta < input.minimumOutputRaw ||
    outputDelta > MAX_U64) return invalid();
  return { status: "CONFIRMED", slot: status.slot,
    actualInputAmountRaw: actualInput.toString(), actualOutputAmountRaw: outputDelta.toString(),
    actualWalletNativeDebitLamportsRaw: nativeDebit.toString() };
}

/** Read only. A missing status/transaction stays pending even past quote expiry;
 * neither absence nor timeout proves failure. Only finalized chain evidence can
 * advance a durable BUY ledger to a terminal state.
 */
export async function reconcileManualBuyOnChain(input: ManualBuyReconciliationInput,
  rpc: SolanaBuyReconciliationRpc = createSolanaRpc(mainnet(getSolanaRpcUrl())) as unknown as SolanaBuyReconciliationRpc,
): Promise<ManualBuyReconciliation> {
  const validated = validate(input);
  try {
    const statusResponse = await rpc.getSignatureStatuses(
      [validated.signature], { searchTransactionHistory: true },
    ).send({ abortSignal: AbortSignal.timeout(10_000) });
    const status = statusSlot(statusResponse);
    if (!status) return { status: "PENDING" };
    const transactionResponse = await rpc.getTransaction(validated.signature, {
      commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0,
    }).send({ abortSignal: AbortSignal.timeout(10_000) });
    if (transactionResponse === null) return { status: "PENDING" };
    return transactionData(transactionResponse, validated, status);
  } catch (cause) {
    if (cause instanceof SolanaBuyReconciliationError) throw cause;
    throw new SolanaBuyReconciliationError({ cause });
  }
}
