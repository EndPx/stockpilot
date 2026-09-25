import "server-only";

import { createHash } from "node:crypto";
import {
  address, appendTransactionMessageInstructions, compileTransaction, createSolanaRpc,
  createTransactionMessage, getAddressDecoder, getAddressEncoder,
  getCompiledTransactionMessageDecoder, getProgramDerivedAddress, getSignatureFromTransaction,
  getTransactionDecoder, getTransactionEncoder, isOffCurveAddress, mainnet, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash, type Instruction,
} from "@solana/kit";
import { SOLANA_MAINNET_USDC_MINT, SPL_TOKEN_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import { getSolanaRpcUrl } from "@/lib/solana/read-adapter";

const SYSTEM = "11111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const U64_MAX = (1n << 64n) - 1n;
const MAX_FEE = 100_000n;
const MAX_RENT = 10_000_000n;

export type TransferKind = "SOL" | "USDC";
export type TransferRequest = { kind: TransferKind; walletAddress: string; recipient: string; amount: string };
export type PreparedTransfer = {
  kind: TransferKind; walletAddress: string; recipient: string; inputAmountRaw: string;
  mint: string | null; decimals: 6 | 9; transaction: string; requestId: string;
  expiresAt: string; lastValidBlockHeight: string; blockhash: string; messageFingerprint: string;
  networkFeeLamportsRaw: string; accountRentLamportsRaw: string; maximumNativeDebitLamportsRaw: string;
  sourceTokenAccount: string | null; destinationAccount: string; createDestinationAta: boolean;
};
type RpcRequest = { send(options?: { abortSignal?: AbortSignal }): Promise<unknown> };
export type TransferRpc = {
  getAccountInfo(account: unknown, options: unknown): RpcRequest;
  getLatestBlockhash(options: unknown): RpcRequest;
  getFeeForMessage(message: unknown, options: unknown): RpcRequest;
  getMinimumBalanceForRentExemption(size: unknown, options: unknown): RpcRequest;
  getSignatureStatuses(signatures: unknown, options: unknown): RpcRequest;
  getTransaction(signature: unknown, options: unknown): RpcRequest;
};
export type TransferReconciliation =
  | { status: "PENDING" }
  | { status: "FAILED"; slot: number }
  | { status: "CONFIRMED"; slot: number; actualInputAmountRaw: string; actualOutputAmountRaw: string;
      actualNativeDebitLamportsRaw: string };

export class TransferError extends Error {
  constructor(readonly code: "INVALID_TRANSFER" | "INSUFFICIENT_BALANCE" | "TRANSFER_UNVERIFIED" | "RPC_UNAVAILABLE") {
    super({ INVALID_TRANSFER: "Enter a valid wallet recipient and transfer amount.",
      INSUFFICIENT_BALANCE: "The wallet balance does not cover this transfer, network fee and account rent.",
      TRANSFER_UNVERIFIED: "The transfer or chain evidence could not be verified.",
      RPC_UNAVAILABLE: "Solana transfer reads are temporarily unavailable." }[code]);
    this.name = "TransferError";
  }
}
function invalid(): never { throw new TransferError("TRANSFER_UNVERIFIED"); }
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown): bigint {
  const result = typeof value === "bigint" ? value :
    typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : null;
  if (result === null || result < 0n || result > U64_MAX) return invalid();
  return result;
}
function raw(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,19})$/.test(value)) return invalid();
  const result = BigInt(value);
  if (result > U64_MAX) return invalid();
  return result;
}
function bytes(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > 2_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return invalid();
  const result = Buffer.from(value, "base64");
  if (result.toString("base64") !== value) return invalid();
  return result;
}
function accountAddress(value: unknown): string {
  try { if (typeof value !== "string") return invalid(); return address(value); } catch { return invalid(); }
}
function humanWallet(value: unknown): string {
  const result = accountAddress(value);
  // This gateway transfers to standard wallets, not arbitrary program vaults.
  if (result === SYSTEM || isOffCurveAddress(address(result))) throw new TransferError("INVALID_TRANSFER");
  return result;
}
export function parseTransferAmount(value: string, decimals: 6 | 9): bigint {
  if ((decimals !== 6 && decimals !== 9) || typeof value !== "string" || value.length > 40 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TransferError("INVALID_TRANSFER");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new TransferError("INVALID_TRANSFER");
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (result <= 0n || result > U64_MAX) throw new TransferError("INVALID_TRANSFER");
  return result;
}
function defaultRpc(): TransferRpc {
  return createSolanaRpc(mainnet(getSolanaRpcUrl())) as unknown as TransferRpc;
}
async function read(request: RpcRequest): Promise<unknown> {
  try { return await request.send({ abortSignal: AbortSignal.timeout(10_000) }); }
  catch { throw new TransferError("RPC_UNAVAILABLE"); }
}
function contextual(value: unknown) {
  const result = row(value);
  const slot = integer(row(result.context).slot);
  if (!Object.hasOwn(result, "value")) return invalid();
  return { slot, value: result.value };
}
type Account = { owner: string; lamports: bigint; data: Buffer };
function account(value: unknown): Account | null {
  if (value === null) return null;
  const result = row(value);
  if (result.executable !== false || !Array.isArray(result.data) || result.data.length !== 2 || result.data[1] !== "base64") return invalid();
  return { owner: accountAddress(result.owner), lamports: integer(result.lamports), data: bytes(result.data[0]) };
}
function systemWallet(value: Account | null, required: boolean): bigint {
  if (!value) return required ? invalid() : 0n;
  if (value.owner !== SYSTEM || value.data.length !== 0) return invalid();
  return value.lamports;
}
function tokenAmount(value: Account | null, owner: string): bigint {
  if (!value || value.owner !== SPL_TOKEN_PROGRAM_ADDRESS || value.data.length !== 165) return invalid();
  const data = value.data;
  const decode = getAddressDecoder();
  if (decode.decode(data.subarray(0, 32)) !== SOLANA_MAINNET_USDC_MINT ||
      decode.decode(data.subarray(32, 64)) !== owner || data[108] !== 1 ||
      data.readUInt32LE(72) !== 0 || data.readUInt32LE(109) !== 0 || data.readUInt32LE(129) !== 0) return invalid();
  return data.readBigUInt64LE(64);
}
export async function transferUsdcAta(owner: string): Promise<string> {
  const encoder = getAddressEncoder();
  return (await getProgramDerivedAddress({ programAddress: address(ATA), seeds: [
    encoder.encode(address(owner)), encoder.encode(address(SPL_TOKEN_PROGRAM_ADDRESS)),
    encoder.encode(address(SOLANA_MAINNET_USDC_MINT)),
  ] }))[0];
}
function instructions(input: Pick<PreparedTransfer, "kind" | "walletAddress" | "recipient" | "inputAmountRaw" |
  "sourceTokenAccount" | "destinationAccount" | "createDestinationAta">): Instruction[] {
  const payer = { address: address(input.walletAddress), role: 3 as const };
  const destination = { address: address(input.destinationAccount), role: 1 as const };
  const amount = raw(input.inputAmountRaw);
  if (input.kind === "SOL") {
    const data = Buffer.alloc(12); data.writeUInt32LE(2, 0); data.writeBigUInt64LE(amount, 4);
    return [{ programAddress: address(SYSTEM), accounts: [payer, destination], data }];
  }
  const result: Instruction[] = [];
  if (input.createDestinationAta) result.push({ programAddress: address(ATA), accounts: [payer, destination,
    { address: address(input.recipient), role: 0 }, { address: address(SOLANA_MAINNET_USDC_MINT), role: 0 },
    { address: address(SYSTEM), role: 0 }, { address: address(SPL_TOKEN_PROGRAM_ADDRESS), role: 0 }],
    data: Uint8Array.of(1) });
  const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(amount, 1); data[9] = 6;
  result.push({ programAddress: address(SPL_TOKEN_PROGRAM_ADDRESS), accounts: [
    { address: address(input.sourceTokenAccount!), role: 1 },
    { address: address(SOLANA_MAINNET_USDC_MINT), role: 0 }, destination, payer,
  ], data });
  return result;
}
function compile(input: Pick<PreparedTransfer, "kind" | "walletAddress" | "recipient" | "inputAmountRaw" |
  "sourceTokenAccount" | "destinationAccount" | "createDestinationAta" | "blockhash" | "lastValidBlockHeight">) {
  return pipe(createTransactionMessage({ version: 0 }),
    (message) => appendTransactionMessageInstructions(instructions(input), message),
    (message) => setTransactionMessageFeePayer(address(input.walletAddress), message),
    (message) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: accountAddress(input.blockhash) as Blockhash,
      lastValidBlockHeight: raw(input.lastValidBlockHeight) }, message), compileTransaction);
}

/** Builds locally; the RPC supplies account facts, blockhash and fee, never instructions. */
export async function prepareTransfer(input: TransferRequest, rpc: TransferRpc = defaultRpc(), now = Date.now()): Promise<PreparedTransfer> {
  try {
    if (input.kind !== "SOL" && input.kind !== "USDC") throw new TransferError("INVALID_TRANSFER");
    const walletAddress = humanWallet(input.walletAddress);
    const recipient = humanWallet(input.recipient);
    if (walletAddress === recipient) throw new TransferError("INVALID_TRANSFER");
    const decimals = input.kind === "SOL" ? 9 : 6;
    const inputAmountRaw = parseTransferAmount(input.amount, decimals).toString();
    const latest = contextual(await read(rpc.getLatestBlockhash({ commitment: "confirmed" })));
    const block = row(latest.value);
    const blockhash = accountAddress(block.blockhash);
    const lastValidBlockHeight = integer(block.lastValidBlockHeight).toString();
    const config = { commitment: "confirmed", encoding: "base64", minContextSlot: latest.slot };
    const readAccount = async (key: string) => {
      const response = contextual(await read(rpc.getAccountInfo(address(key), config)));
      if (response.slot < latest.slot) return invalid();
      return account(response.value);
    };
    const [wallet, recipientAccount] = await Promise.all([readAccount(walletAddress), readAccount(recipient)]);
    const nativeBalance = systemWallet(wallet, true);
    systemWallet(recipientAccount, false);
    let sourceTokenAccount: string | null = null;
    let destinationAccount = recipient;
    let createDestinationAta = false;
    let accountRent = 0n;
    if (input.kind === "USDC") {
      sourceTokenAccount = await transferUsdcAta(walletAddress);
      destinationAccount = await transferUsdcAta(recipient);
      const [source, destination, mint] = await Promise.all([
        readAccount(sourceTokenAccount), readAccount(destinationAccount), readAccount(SOLANA_MAINNET_USDC_MINT),
      ]);
      if (!mint || mint.owner !== SPL_TOKEN_PROGRAM_ADDRESS || mint.data.length !== 82 || mint.data[44] !== 6 || mint.data[45] !== 1) return invalid();
      if (tokenAmount(source, walletAddress) < BigInt(inputAmountRaw)) throw new TransferError("INSUFFICIENT_BALANCE");
      if (destination) tokenAmount(destination, recipient);
      else {
        createDestinationAta = true;
        accountRent = integer(await read(rpc.getMinimumBalanceForRentExemption(165n, { commitment: "confirmed" })));
        if (accountRent <= 0n || accountRent > MAX_RENT) return invalid();
      }
    }
    const basis = { kind: input.kind, walletAddress, recipient, inputAmountRaw, sourceTokenAccount,
      destinationAccount, createDestinationAta, blockhash, lastValidBlockHeight };
    const compiled = compile(basis);
    const transaction = Buffer.from(getTransactionEncoder().encode(compiled)).toString("base64");
    const feeResponse = contextual(await read(rpc.getFeeForMessage(Buffer.from(compiled.messageBytes).toString("base64"),
      { commitment: "confirmed", minContextSlot: latest.slot })));
    if (feeResponse.slot < latest.slot) return invalid();
    const fee = integer(feeResponse.value);
    if (fee <= 0n || fee > MAX_FEE) return invalid();
    const nativeDebit = fee + accountRent + (input.kind === "SOL" ? BigInt(inputAmountRaw) : 0n);
    if (nativeDebit > U64_MAX || nativeBalance < nativeDebit) throw new TransferError("INSUFFICIENT_BALANCE");
    const prepared: PreparedTransfer = { ...basis, decimals, transaction,
      mint: input.kind === "USDC" ? SOLANA_MAINNET_USDC_MINT : null,
      requestId: `build:${createHash("sha256").update(transaction).digest("hex")}`,
      messageFingerprint: createHash("sha256").update(Buffer.from(compiled.messageBytes)).digest("base64url"),
      expiresAt: new Date(now + 60_000).toISOString(), networkFeeLamportsRaw: fee.toString(),
      accountRentLamportsRaw: accountRent.toString(), maximumNativeDebitLamportsRaw: nativeDebit.toString() };
    await assertPreparedTransferTransaction(prepared);
    return prepared;
  } catch (error) {
    if (error instanceof TransferError) throw error;
    throw new TransferError("TRANSFER_UNVERIFIED");
  }
}

/** Independent exact-message reconstruction from immutable authorization fields. */
export async function assertPreparedTransferTransaction(prepared: PreparedTransfer, wire = prepared.transaction): Promise<void> {
  try {
    const wallet = humanWallet(prepared.walletAddress);
    const recipient = humanWallet(prepared.recipient);
    if (wallet === recipient || !["SOL", "USDC"].includes(prepared.kind) || raw(prepared.inputAmountRaw) <= 0n ||
        !Number.isFinite(Date.parse(prepared.expiresAt))) return invalid();
    const fee = raw(prepared.networkFeeLamportsRaw);
    const rent = raw(prepared.accountRentLamportsRaw);
    if (fee <= 0n || fee > MAX_FEE || rent > MAX_RENT) return invalid();
    if (prepared.kind === "SOL") {
      if (prepared.mint !== null || prepared.decimals !== 9 || prepared.sourceTokenAccount !== null ||
          prepared.destinationAccount !== recipient || prepared.createDestinationAta !== false || rent !== 0n) return invalid();
    } else {
      if (prepared.mint !== SOLANA_MAINNET_USDC_MINT || prepared.decimals !== 6 ||
          prepared.sourceTokenAccount !== await transferUsdcAta(wallet) ||
          prepared.destinationAccount !== await transferUsdcAta(recipient) ||
          typeof prepared.createDestinationAta !== "boolean" || prepared.createDestinationAta !== (rent > 0n)) return invalid();
    }
    const cap = fee + rent + (prepared.kind === "SOL" ? raw(prepared.inputAmountRaw) : 0n);
    if (raw(prepared.maximumNativeDebitLamportsRaw) !== cap) return invalid();
    const expected = compile(prepared);
    const unsigned = Buffer.from(getTransactionEncoder().encode(expected)).toString("base64");
    const transaction = getTransactionDecoder().decode(bytes(wire));
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (bytes(wire).length > 1_232 || message.version !== 0 ||
        !Buffer.from(getTransactionEncoder().encode(transaction)).equals(bytes(wire)) ||
        !Buffer.from(transaction.messageBytes).equals(Buffer.from(expected.messageBytes)) ||
        Object.keys(transaction.signatures).length !== 1 || !Object.hasOwn(transaction.signatures, wallet) ||
        prepared.transaction !== unsigned ||
        prepared.requestId !== `build:${createHash("sha256").update(unsigned).digest("hex")}` ||
        prepared.messageFingerprint !== createHash("sha256").update(Buffer.from(expected.messageBytes)).digest("base64url")) return invalid();
  } catch (error) {
    if (error instanceof TransferError) throw error;
    throw new TransferError("TRANSFER_UNVERIFIED");
  }
}

function tokenBalances(value: unknown, keys: readonly string[]): Map<number, { owner: string; amount: bigint }> {
  if (!Array.isArray(value)) return invalid();
  const balances = new Map<number, { owner: string; amount: bigint }>();
  for (const item of value) {
    const entry = row(item); const token = row(entry.uiTokenAmount);
    if (typeof entry.accountIndex !== "number" || !Number.isInteger(entry.accountIndex) ||
        entry.accountIndex < 0 || entry.accountIndex >= keys.length || balances.has(entry.accountIndex) ||
        entry.programId !== SPL_TOKEN_PROGRAM_ADDRESS || entry.mint !== SOLANA_MAINNET_USDC_MINT || token.decimals !== 6) return invalid();
    balances.set(entry.accountIndex, { owner: accountAddress(entry.owner), amount: raw(token.amount) });
  }
  return balances;
}

/** Read only. Absent and non-finalized evidence cannot authorize another submission. */
export async function reconcileTransferOnChain(input: { prepared: PreparedTransfer; signature: string },
  rpc: TransferRpc = defaultRpc()): Promise<TransferReconciliation> {
  try {
    await assertPreparedTransferTransaction(input.prepared);
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(input.signature)) return invalid();
    const statusResponse = contextual(await read(rpc.getSignatureStatuses([input.signature], { searchTransactionHistory: true })));
    if (!Array.isArray(statusResponse.value) || statusResponse.value.length !== 1) return invalid();
    if (statusResponse.value[0] === null) return { status: "PENDING" };
    const status = row(statusResponse.value[0]);
    if (!Object.hasOwn(status, "err")) return invalid();
    if (status.confirmationStatus !== "finalized") return { status: "PENDING" };
    const slot = integer(status.slot);
    if (slot > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
    const response = await read(rpc.getTransaction(input.signature,
      { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }));
    if (response === null) return { status: "PENDING" };
    const result = row(response); const meta = row(result.meta);
    if (integer(result.slot) !== slot || result.version !== 0 || !Object.hasOwn(meta, "err") ||
        !Array.isArray(result.transaction) || result.transaction.length !== 2 || result.transaction[1] !== "base64") return invalid();
    const wire = result.transaction[0];
    if (typeof wire !== "string") return invalid();
    await assertPreparedTransferTransaction(input.prepared, wire);
    const transaction = getTransactionDecoder().decode(bytes(wire));
    if (getSignatureFromTransaction(transaction) !== input.signature) return invalid();
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const keys = message.staticAccounts;
    if (!Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances) ||
        meta.preBalances.length !== keys.length || meta.postBalances.length !== keys.length) return invalid();
    const loaded = row(meta.loadedAddresses);
    if (!Array.isArray(loaded.writable) || loaded.writable.length || !Array.isArray(loaded.readonly) || loaded.readonly.length) return invalid();
    const before = meta.preBalances.map(integer); const after = meta.postBalances.map(integer);
    const fee = integer(meta.fee);
    if (fee !== raw(input.prepared.networkFeeLamportsRaw) || (status.err === null) !== (meta.err === null)) return invalid();
    const nativeDebit = before[0] - after[0];
    if (nativeDebit < fee || nativeDebit > raw(input.prepared.maximumNativeDebitLamportsRaw)) return invalid();
    const failed = meta.err !== null;
    const destination = keys.indexOf(address(input.prepared.destinationAccount));
    if (destination < 1) return invalid();
    const rentPaid = !failed && input.prepared.kind === "USDC" ? after[destination] - before[destination] : 0n;
    if (rentPaid < 0n || rentPaid > raw(input.prepared.accountRentLamportsRaw) ||
        rentPaid > 0n && (!input.prepared.createDestinationAta || before[destination] !== 0n)) return invalid();
    const principal = !failed && input.prepared.kind === "SOL" ? raw(input.prepared.inputAmountRaw) : 0n;
    if (nativeDebit !== fee + rentPaid + principal) return invalid();
    for (let index = 1; index < keys.length; index++) {
      const expected = index === destination ? (input.prepared.kind === "SOL" ? principal : rentPaid) : 0n;
      if (after[index] - before[index] !== expected) return invalid();
    }
    const pre = tokenBalances(meta.preTokenBalances, keys);
    const post = tokenBalances(meta.postTokenBalances, keys);
    if (failed) {
      // Accounts can disappear between preparation and execution. A finalized
      // failure may resolve only when the exact signed message charged just its
      // network fee and made no native/token movements, even if the source ATA
      // was already absent when execution began.
      if (pre.size !== post.size) return invalid();
      for (const [index, balance] of pre) {
        const afterBalance = post.get(index);
        if (!afterBalance || afterBalance.owner !== balance.owner || afterBalance.amount !== balance.amount) return invalid();
      }
      return { status: "FAILED", slot: Number(slot) };
    }
    if (input.prepared.kind === "SOL") {
      if (pre.size || post.size) return invalid();
    } else {
      const source = keys.indexOf(address(input.prepared.sourceTokenAccount!));
      if (source < 1) return invalid();
      for (const index of new Set([...pre.keys(), ...post.keys()])) {
        if (index !== source && index !== destination) return invalid();
      }
      const beforeSource = pre.get(source); const afterSource = post.get(source);
      const beforeDestination = pre.get(destination); const afterDestination = post.get(destination);
      if (!beforeSource || !afterSource || beforeSource.owner !== input.prepared.walletAddress ||
          afterSource.owner !== input.prepared.walletAddress ||
          beforeSource.amount - afterSource.amount !== (failed ? 0n : raw(input.prepared.inputAmountRaw))) return invalid();
      if (!afterDestination) {
        if (!failed || beforeDestination || before[destination] !== 0n || after[destination] !== 0n) return invalid();
      } else {
        if (afterDestination.owner !== input.prepared.recipient ||
            beforeDestination && beforeDestination.owner !== input.prepared.recipient ||
            !beforeDestination && before[destination] !== 0n ||
            afterDestination.amount - (beforeDestination?.amount ?? 0n) !== (failed ? 0n : raw(input.prepared.inputAmountRaw))) return invalid();
      }
    }
    return { status: "CONFIRMED", slot: Number(slot),
      actualInputAmountRaw: input.prepared.inputAmountRaw, actualOutputAmountRaw: input.prepared.inputAmountRaw,
      actualNativeDebitLamportsRaw: nativeDebit.toString() };
  } catch (error) {
    if (error instanceof TransferError) throw error;
    throw new TransferError("TRANSFER_UNVERIFIED");
  }
}
