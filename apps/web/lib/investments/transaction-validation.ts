import "server-only";

import { createHash } from "node:crypto";
import {
  address,
  createSolanaRpc,
  decompileTransactionMessage,
  fetchAddressesForLookupTables,
  getProgramDerivedAddress,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  isWritableRole,
  mainnet,
  type Address,
  type TransactionMessageBytesBase64,
} from "@solana/kit";
import type { PreparedInvestment } from "@stockpilot/core/investments";
import type { PreparedManualSell } from "@stockpilot/core/manual-sell";
import type { PreparedXStocksBuy } from "@stockpilot/core/xstocks-manual-buy";
import { SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import { getSolanaRpcUrl } from "@/lib/solana/read-adapter";

const MAX_TRANSACTION_BYTES = 1_232;
const MAX_ACCOUNTS = 64;
const MAX_INSTRUCTIONS = 32;
const MAX_LOOKUP_TABLES = 4;
const MAX_U64 = 18_446_744_073_709_551_615n;
const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MAX_MANUAL_SLIPPAGE_BPS = 100n;
const MAX_MANUAL_NETWORK_FEE_LAMPORTS = 300_000n;
const MAX_ATA_RENT_LAMPORTS = 10_000_000n;
const MAX_TRANSFER_FEE_BPS = 300;
const DEMO_PRESTOCKS_FEE_MINT = "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP";
const TOKEN_2022_DISPLAY_EXTENSIONS = new Set([
  "scaledUiAmountConfig", "metadataPointer", "tokenMetadata", "groupPointer", "groupMemberPointer",
  "permanentDelegate", "defaultAccountState", "pausableConfig", "confidentialTransferMint",
  "confidentialTransferFeeConfig", "transferHook", "transferFeeConfig",
]);
const ROUTE_DISCRIMINATOR = createHash("sha256").update("global:route").digest().subarray(0, 8);
const SHARED_ROUTE_DISCRIMINATOR = createHash("sha256").update("global:shared_accounts_route").digest().subarray(0, 8);
const ROUTE_V2_DISCRIMINATOR = createHash("sha256").update("global:route_v2").digest().subarray(0, 8);
const RAYDIUM_CLMM_V2_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

export type PreparedTradeTransaction = PreparedInvestment | PreparedXStocksBuy | PreparedManualSell;

type TradeEconomics = Readonly<{
  walletAddress: string;
  requestId: string;
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  outputAmountRaw: string;
  inputDecimals: number;
  outputDecimals: number;
  requiredMinimumOutputRaw: string;
  feeBps: number | null;
  feeMint: string | null;
  transaction: string;
}>;

function tradeEconomics(prepared: PreparedTradeTransaction): TradeEconomics {
  if ("fundingAsset" in prepared) {
    const quoted = rawU64(prepared.outputAmountRaw, "INVALID_TRANSACTION");
    const minimumBps = prepared.asset.mintAddress === DEMO_PRESTOCKS_FEE_MINT ? 9_600n : 9_900n;
    return {
      walletAddress: prepared.walletAddress, requestId: prepared.requestId,
      inputMint: prepared.fundingAsset.mintAddress, outputMint: prepared.asset.mintAddress,
      inputAmountRaw: prepared.inputAmountRaw, outputAmountRaw: prepared.outputAmountRaw,
      inputDecimals: 6, outputDecimals: prepared.outputDecimals,
      requiredMinimumOutputRaw: (quoted * minimumBps / 10_000n).toString(),
      feeBps: prepared.feeBps, feeMint: prepared.feeMint, transaction: prepared.transaction,
    };
  }
  if ("quotedOutputRaw" in prepared) {
    const quoted = rawU64(prepared.quotedOutputRaw, "INVALID_TRANSACTION");
    const productMinimum = rawU64(prepared.requiredMinimumOutputRaw, "INVALID_TRANSACTION");
    const slippageMinimum = quoted * (10_000n - MAX_MANUAL_SLIPPAGE_BPS) / 10_000n;
    return {
      walletAddress: prepared.walletAddress, requestId: prepared.requestId,
      inputMint: prepared.inputMint, outputMint: prepared.outputMint,
      inputAmountRaw: prepared.inputRaw, outputAmountRaw: prepared.quotedOutputRaw,
      inputDecimals: 6, outputDecimals: prepared.outputDecimals,
      requiredMinimumOutputRaw: (productMinimum > slippageMinimum ? productMinimum : slippageMinimum).toString(),
      feeBps: prepared.feeBps, feeMint: prepared.feeMint, transaction: prepared.transaction,
    };
  }
  const quoted = rawU64(prepared.quotedUsdcOutRaw, "INVALID_TRANSACTION");
  const userMinimum = rawU64(prepared.requiredMinimumUsdcOutRaw, "INVALID_TRANSACTION");
  const slippageMinimum = quoted * (10_000n - MAX_MANUAL_SLIPPAGE_BPS) / 10_000n;
  return {
    walletAddress: prepared.walletAddress, requestId: prepared.requestId,
    inputMint: prepared.inputMint, outputMint: prepared.outputMint,
    inputAmountRaw: prepared.inputRaw, outputAmountRaw: prepared.quotedUsdcOutRaw,
    inputDecimals: prepared.inputDecimals, outputDecimals: 6,
    requiredMinimumOutputRaw: (userMinimum > slippageMinimum ? userMinimum : slippageMinimum).toString(),
    feeBps: prepared.feeBps, feeMint: prepared.feeMint, transaction: prepared.transaction,
  };
}

export type TransactionValidationCode =
  | "INVALID_TRANSACTION"
  | "UNRESOLVED_LOOKUP_TABLE"
  | "UNAUTHORIZED_ACCOUNT"
  | "UNAUTHORIZED_PROGRAM"
  | "TRANSACTION_SEMANTICS_UNVERIFIED"
  | "ECONOMIC_LIMIT_EXCEEDED";

export class TransactionValidationError extends Error {
  constructor(readonly code: TransactionValidationCode) {
    super(code);
    this.name = "TransactionValidationError";
  }
}

export type ResolvedInstruction = Readonly<{
  programAddress: string;
  accounts: readonly Readonly<{ address: string; writable: boolean; signer: boolean }>[];
  data: Uint8Array;
}>;

export type PreparedTransactionInspection = Readonly<{
  feePayer: string;
  allAddresses: readonly string[];
  writableAddresses: readonly string[];
  lookupTableAddresses: readonly string[];
  instructions: readonly ResolvedInstruction[];
  /** Present only after every instruction and the network-fee quote have been checked. */
  effects?: Readonly<{
    maximumInputRaw: string;
    requiredMinimumOutputRaw: string;
    maximumWalletNativeDebitLamportsRaw: string;
  }>;
}>;

/** A trusted server adapter must fetch the complete, current table, not just caller-selected indexes. */
export type LookupTableResolver = (tableAddress: string) => Promise<readonly string[]>;

/**
 * Proof produced by a route-specific, instruction-level verifier. It must include inner
 * program effects and all possible spend paths; simulation or an API quote is not proof.
 */
export type InstructionEffectProof = Readonly<{
  requestId: string;
  inputMint: string;
  outputMint: string;
  /** Maximum swap principal, excluding tokenFees. The validator adds same-mint fees. */
  maximumInputRaw: string;
  /** Minimum tokens reaching the owner's wallet, net of output-mint fees. */
  guaranteedMinimumOutputRaw: string;
  maximumNetworkFeeLamports: string;
  tokenFees: readonly Readonly<{ mint: string; raw: string }>[];
  otherTokenDebits: readonly Readonly<{ mint: string; raw: string }>[];
  otherNativeDebitLamports: string;
  coveredInstructionIndexes: readonly number[];
}>;

export type PreparedTransactionPolicy = Readonly<{
  allowedProgramIds: readonly string[];
  allowedWritableAddresses: readonly string[];
  minimumOutputRaw: string;
  maximumNetworkFeeLamports: string;
  /** Independent limit for exact wallet-funded associated-token-account creation. */
  maximumAdditionalNativeDebitLamports?: string;
  maximumTokenFeesRaw: Readonly<Record<string, string>>;
  resolveLookupTable?: LookupTableResolver;
  /** Independently verifies the fee for the exact serialized message and live blockhash. */
  getNetworkFeeLamports?: (messageBase64: string) => Promise<string>;
  /** A route-specific verifier may audit writable accounts against current RPC state. */
  verifyWritableAccounts?: (inspection: PreparedTransactionInspection, prepared: PreparedTradeTransaction) => Promise<void>;
  verifyInstructionEffects?: (
    inspection: PreparedTransactionInspection,
    prepared: PreparedTradeTransaction,
    verifiedNetworkFeeLamports: string,
  ) => Promise<InstructionEffectProof>;
}>;

/**
 * Safe route placeholder. It is intentionally impossible to authorize an order
 * with this policy; replace it only after a reviewed Jupiter instruction parser,
 * ALT resolver, and owner-approved economic limits exist on the server.
 */
export const MANUAL_BUY_FAIL_CLOSED_POLICY: PreparedTransactionPolicy = Object.freeze({
  allowedProgramIds: Object.freeze([]),
  allowedWritableAddresses: Object.freeze([]),
  minimumOutputRaw: "0",
  maximumNetworkFeeLamports: "0",
  maximumTokenFeesRaw: Object.freeze({}),
});

function fail(code: TransactionValidationCode): never {
  throw new TransactionValidationError(code);
}

function rawU64(value: string, code: TransactionValidationCode): bigint {
  if (typeof value !== "string" || value.length > 20 || !/^(0|[1-9]\d*)$/.test(value)) fail(code);
  const amount = BigInt(value);
  if (amount > MAX_U64) fail(code);
  return amount;
}

function validAddress(value: string, code: TransactionValidationCode): Address {
  try { return address(value); } catch { return fail(code); }
}

function canonicalTransactionBytes(serialized: string): Uint8Array {
  if (typeof serialized !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(serialized)) fail("INVALID_TRANSACTION");
  const bytes = Buffer.from(serialized, "base64");
  if (bytes.length === 0 || bytes.length > MAX_TRANSACTION_BYTES || bytes.toString("base64") !== serialized) fail("INVALID_TRANSACTION");
  return bytes;
}

/** Pre-quote envelope guard; a true result is never transaction-effect approval. */
export async function verifyUnsignedOrderEnvelope(serialized: string, walletAddress: string): Promise<boolean> {
  try {
    const wallet = validAddress(walletAddress, "INVALID_TRANSACTION").toString();
    const transaction = getTransactionDecoder().decode(canonicalTransactionBytes(serialized));
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    return message.version === 0 && message.header.numSignerAccounts === 1 &&
      message.header.numReadonlySignerAccounts === 0 && message.staticAccounts[0] === wallet &&
      Object.keys(transaction.signatures).length === 1 && transaction.signatures[wallet as Address] === null;
  } catch {
    return false;
  }
}

function uniqueAddresses(values: readonly string[], code: TransactionValidationCode): Set<string> {
  const result = new Set(values.map((value) => validAddress(value, code).toString()));
  if (result.size !== values.length) fail(code);
  return result;
}

/** Resolve every ALT through Solana's JSON-parsed account decoder at confirmed commitment. */
export function createSolanaLookupTableResolver(rpcUrl = getSolanaRpcUrl()): LookupTableResolver {
  const rpc = createSolanaRpc(mainnet(rpcUrl));
  return async (tableAddress) => {
    const table = validAddress(tableAddress, "UNRESOLVED_LOOKUP_TABLE");
    const resolved = await fetchAddressesForLookupTables([table], rpc, { commitment: "confirmed" });
    const entries = resolved[table];
    if (!Array.isArray(entries)) fail("UNRESOLVED_LOOKUP_TABLE");
    return entries.map(String);
  };
}

/** Solana RPC calculates signature and compute-priority fees for the exact v0 message. */
export function createSolanaNetworkFeeReader(rpcUrl = getSolanaRpcUrl()): NonNullable<PreparedTransactionPolicy["getNetworkFeeLamports"]> {
  const rpc = createSolanaRpc(mainnet(rpcUrl));
  return async (messageBase64) => {
    const response = await rpc.getFeeForMessage(messageBase64 as TransactionMessageBytesBase64, { commitment: "confirmed" })
      .send({ abortSignal: AbortSignal.timeout(10_000) });
    if (response.value === null || typeof response.value !== "bigint" || response.value < 0n) {
      fail("TRANSACTION_SEMANTICS_UNVERIFIED");
    }
    return response.value.toString();
  };
}

type ParsedJupiterRoute = Readonly<{
  swapInstructionIndex: number;
  ataCreateInstructionIndex: number | null;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  maximumInputRaw: string;
  minimumOutputRaw: string;
  variant: "route" | "shared_accounts_route" | "route_v2";
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function assertComputeBudget(instruction: ResolvedInstruction): void {
  if (instruction.accounts.length !== 0) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  const data = instruction.data;
  if (data[0] === 2 && data.length === 5) {
    const units = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
    if (units > 1_400_000 || units === 0) fail("ECONOMIC_LIMIT_EXCEEDED");
    return;
  }
  if (data[0] === 3 && data.length === 9) return;
  fail("TRANSACTION_SEMANTICS_UNVERIFIED");
}

function assertAtaCreateShape(instruction: ResolvedInstruction, trade: TradeEconomics, destination: string): string {
  const accounts = instruction.accounts;
  if (instruction.programAddress !== ASSOCIATED_TOKEN_PROGRAM ||
      instruction.data.length !== 1 || instruction.data[0] !== 1 || accounts.length !== 6 ||
      accounts[0].address !== trade.walletAddress || !accounts[0].writable || !accounts[0].signer ||
      accounts[1].address !== destination || !accounts[1].writable || accounts[1].signer ||
      accounts[2].address !== trade.walletAddress || !accounts[2].signer ||
      accounts[3].address !== trade.outputMint || accounts[3].writable || accounts[3].signer ||
      accounts[4].address !== SYSTEM_PROGRAM || accounts[4].writable || accounts[4].signer ||
      ![SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(accounts[5].address) ||
      accounts[5].writable || accounts[5].signer) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  return accounts[5].address;
}

export async function verifyCanonicalAssociatedTokenAccountCreation(
  instruction: ResolvedInstruction, prepared: PreparedTradeTransaction, destination: string, tokenProgram: string,
): Promise<void> {
  const trade = tradeEconomics(prepared);
  const declaredProgram = assertAtaCreateShape(instruction, trade, destination);
  if (declaredProgram !== tokenProgram) fail("UNAUTHORIZED_ACCOUNT");
  const key = getAddressEncoder();
  const [derived] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [key.encode(address(trade.walletAddress)), key.encode(address(tokenProgram)), key.encode(address(trade.outputMint))],
  });
  if (derived !== destination) fail("UNAUTHORIZED_ACCOUNT");
}

/**
 * Only the one-leg Raydium variant of Jupiter V6's original exact-in route
 * has a fixed, fully decoded Borsh layout here. New V2, RFQ, multi-hop,
 * account-creation, cleanup and tip variants have intentionally no decoder.
 */
export function parseSupportedJupiterRoute(inspection: PreparedTransactionInspection, prepared: PreparedTradeTransaction): ParsedJupiterRoute {
  const trade = tradeEconomics(prepared);
  const swaps = inspection.instructions
    .map((instruction, index) => ({ instruction, index }))
    .filter(({ instruction }) => instruction.programAddress === JUPITER_V6_PROGRAM);
  if (swaps.length !== 1 || inspection.instructions.length > 5 ||
      swaps[0].index !== inspection.instructions.length - 1 ||
      trade.feeMint !== null || trade.feeBps !== null && trade.feeBps !== 0) {
    fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  }
  const { instruction, index: swapInstructionIndex } = swaps[0];
  const budgetKinds = new Set<number>();
  let ataCreateInstructionIndex: number | null = null;
  for (const other of inspection.instructions.slice(0, swapInstructionIndex)) {
    if (other.programAddress === COMPUTE_BUDGET_PROGRAM) {
      if (ataCreateInstructionIndex !== null) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
      assertComputeBudget(other);
      if (budgetKinds.has(other.data[0])) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
      budgetKinds.add(other.data[0]);
    } else if (other.programAddress === ASSOCIATED_TOKEN_PROGRAM) {
      if (ataCreateInstructionIndex !== null) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
      ataCreateInstructionIndex = inspection.instructions.indexOf(other);
    } else fail("UNAUTHORIZED_PROGRAM");
  }
  const data = instruction.data;
  const routeV2 = data.length >= 39 && Buffer.from(data.subarray(0, 8)).equals(ROUTE_V2_DISCRIMINATOR);
  const shared = data.length >= 36 && Buffer.from(data.subarray(0, 8)).equals(SHARED_ROUTE_DISCRIMINATOR);
  const direct = data.length >= 35 && Buffer.from(data.subarray(0, 8)).equals(ROUTE_DISCRIMINATOR);
  if (!routeV2 && !shared && !direct) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  if (routeV2) {
    // Jupiter V6 route_v2 Borsh layout, restricted to exactly one reviewed
    // Raydium CLMM V2 or Meteora DLMM Swap V2 leg. Never infer the venue from
    // the provider's route label alone.
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const variant = data[34];
    const meteora = variant === 75 && data.length === 43 && view.getUint32(35, true) === 0;
    const raydium = variant === 40 && data.length === 39;
    if ((!meteora && !raydium) || view.getUint16(24, true) > Number(MAX_MANUAL_SLIPPAGE_BPS) ||
        view.getUint16(26, true) !== 0 || view.getUint16(28, true) !== 0 ||
        view.getUint32(30, true) !== 1) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
    const stepOffset = meteora ? 39 : 35;
    if (view.getUint16(stepOffset, true) !== 10_000 || data[stepOffset + 2] !== 0 ||
        data[stepOffset + 3] !== 1) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
    const input = view.getBigUint64(8, true);
    const output = view.getBigUint64(16, true);
    if (!input || input !== rawU64(trade.inputAmountRaw, "INVALID_TRANSACTION") ||
        !output || output !== rawU64(trade.outputAmountRaw, "INVALID_TRANSACTION")) {
      fail("ECONOMIC_LIMIT_EXCEEDED");
    }
    const accounts = instruction.accounts;
    const expectedDexProgram = meteora ? METEORA_DLMM_PROGRAM : RAYDIUM_CLMM_V2_PROGRAM;
    if (accounts.length < 11 || accounts[0].address !== trade.walletAddress ||
        !accounts[0].signer ||
        !accounts[1].writable || !accounts[2].writable ||
        accounts[3].address !== trade.inputMint || accounts[4].address !== trade.outputMint ||
        ![SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(accounts[5].address) ||
        ![SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].includes(accounts[6].address) ||
        accounts[7].address !== JUPITER_V6_PROGRAM || accounts[9].address !== JUPITER_V6_PROGRAM ||
        accounts[10].address !== expectedDexProgram ||
        accounts.some((entry) => entry.address === SYSTEM_PROGRAM)) fail("UNAUTHORIZED_ACCOUNT");
    if (ataCreateInstructionIndex !== null) {
      assertAtaCreateShape(inspection.instructions[ataCreateInstructionIndex], trade, accounts[2].address);
    }
    const minimum = output * (10_000n - BigInt(view.getUint16(24, true))) / 10_000n;
    if (!minimum) fail("ECONOMIC_LIMIT_EXCEEDED");
    return {
      swapInstructionIndex, ataCreateInstructionIndex,
      sourceTokenAccount: accounts[1].address,
      destinationTokenAccount: accounts[2].address,
      maximumInputRaw: input.toString(), minimumOutputRaw: minimum.toString(),
      variant: "route_v2",
    };
  }
  const offset = shared ? 9 : 8;
  const expectedLength = shared ? 36 : 35;
  if (data.length !== expectedLength) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // The official V6 IDL declares Vec<RoutePlanStep>. Only one fixed-size
  // Raydium step (enum variant 7, no payload) can be unambiguously parsed.
  if (view.getUint32(offset, true) !== 1 || data[offset + 4] !== 7 ||
      data[offset + 5] !== 100 || data[offset + 6] !== 0 || data[offset + 7] !== 1) {
    fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  }
  const amountOffset = offset + 8;
  const input = view.getBigUint64(amountOffset, true);
  const quotedOutput = view.getBigUint64(amountOffset + 8, true);
  const slippageBps = BigInt(view.getUint16(amountOffset + 16, true));
  const platformFeeBps = data[amountOffset + 18];
  if (input === 0n || input !== rawU64(trade.inputAmountRaw, "INVALID_TRANSACTION") ||
      quotedOutput === 0n || quotedOutput !== rawU64(trade.outputAmountRaw, "INVALID_TRANSACTION") ||
      slippageBps > MAX_MANUAL_SLIPPAGE_BPS || platformFeeBps !== 0) {
    fail("ECONOMIC_LIMIT_EXCEEDED");
  }
  const account = instruction.accounts;
  const authorityIndex = shared ? 2 : 1;
  const sourceIndex = shared ? 3 : 2;
  const destinationIndex = shared ? 6 : 3;
  const outputMintIndex = shared ? 8 : 5;
  if (account.length <= outputMintIndex || account[0].address !== SPL_TOKEN_PROGRAM_ADDRESS ||
      account[authorityIndex].address !== trade.walletAddress || !account[authorityIndex].signer ||
      !account[sourceIndex].writable || !account[destinationIndex].writable ||
      account[outputMintIndex].address !== trade.outputMint ||
      account.some((entry, position) => position !== authorityIndex && entry.address === trade.walletAddress) ||
      account.some((entry) => entry.address === SYSTEM_PROGRAM)) {
    fail("UNAUTHORIZED_ACCOUNT");
  }
  if (shared) {
    if (account.length < 10 || account[7].address !== trade.inputMint ||
        account[9].address !== JUPITER_V6_PROGRAM) fail("UNAUTHORIZED_ACCOUNT");
  } else if (account.length < 7 || account[4].address !== JUPITER_V6_PROGRAM ||
             account[6].address !== JUPITER_V6_PROGRAM) {
    fail("UNAUTHORIZED_ACCOUNT");
  }
  if (ataCreateInstructionIndex !== null) {
    assertAtaCreateShape(inspection.instructions[ataCreateInstructionIndex], trade, account[destinationIndex].address);
  }
  const guaranteed = quotedOutput * (10_000n - slippageBps) / 10_000n;
  if (guaranteed === 0n) fail("ECONOMIC_LIMIT_EXCEEDED");
  return {
    swapInstructionIndex,
    ataCreateInstructionIndex,
    sourceTokenAccount: account[sourceIndex].address,
    destinationTokenAccount: account[destinationIndex].address,
    maximumInputRaw: input.toString(),
    minimumOutputRaw: guaranteed.toString(),
    variant: shared ? "shared_accounts_route" : "route",
  };
}

function parsedTokenAccount(value: unknown): Record<string, unknown> | null {
  const account = record(value);
  const data = record(account?.data);
  const parsed = record(data?.parsed);
  if ((account?.owner !== SPL_TOKEN_PROGRAM_ADDRESS && account?.owner !== TOKEN_2022_PROGRAM_ADDRESS) ||
      parsed?.type !== "account") return null;
  return record(parsed.info);
}

function assertMintCompatibility(value: unknown, expectedDecimals?: number): { owner: string; transferFeeBps: number } {
  const account = record(value);
  const data = record(account?.data);
  const parsed = record(data?.parsed);
  const info = record(parsed?.info);
  if (!account || (account.owner !== SPL_TOKEN_PROGRAM_ADDRESS && account.owner !== TOKEN_2022_PROGRAM_ADDRESS) ||
      parsed?.type !== "mint" || info?.isInitialized !== true ||
      !Number.isInteger(info.decimals) ||
      expectedDecimals !== undefined && info.decimals !== expectedDecimals) {
    fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  }
  const extensions = info.extensions;
  let transferFeeBps = 0;
  if (account.owner === TOKEN_2022_PROGRAM_ADDRESS) {
    if (!Array.isArray(extensions) || extensions.some((extension) =>
      !TOKEN_2022_DISPLAY_EXTENSIONS.has(String(record(extension)?.extension)))) {
      fail("TRANSACTION_SEMANTICS_UNVERIFIED");
    }
    for (const extension of extensions) {
      const row = record(extension);
      const state = record(row?.state);
      if (row?.extension === "defaultAccountState" && state?.accountState !== "initialized" ||
          row?.extension === "pausableConfig" && state?.paused !== false ||
          row?.extension === "transferHook" && state?.programId !== null) {
        fail("TRANSACTION_SEMANTICS_UNVERIFIED");
      }
      if (row?.extension === "transferFeeConfig") {
        const older = record(state?.olderTransferFee);
        const newer = record(state?.newerTransferFee);
        const rates = [older?.transferFeeBasisPoints, newer?.transferFeeBasisPoints];
        if (rates.some((rate) => !Number.isInteger(rate) || Number(rate) < 0 ||
            Number(rate) > MAX_TRANSFER_FEE_BPS)) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
        transferFeeBps = Math.max(...rates.map(Number));
      }
    }
  } else if (extensions !== undefined && Array.isArray(extensions) && extensions.length > 0) {
    fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  }
  return { owner: String(account.owner), transferFeeBps };
}

/**
 * Server-owned manual trade policy for the one decoded Jupiter V6 exact-in
 * route. A destination account may be created in the same transaction only by
 * one exact, canonically derived idempotent ATA instruction funded by the wallet.
 * Unsupported routes stay blocked before Privy signing.
 */
export function createManualTradeValidationPolicy(prepared: PreparedTradeTransaction): PreparedTransactionPolicy {
  const expected = tradeEconomics(prepared);
  const quoted = rawU64(expected.outputAmountRaw, "INVALID_TRANSACTION");
  if (quoted === 0n) fail("INVALID_TRANSACTION");
  const minimumOutputRaw = expected.requiredMinimumOutputRaw;
  if (minimumOutputRaw === "0") fail("ECONOMIC_LIMIT_EXCEEDED");
  const rpc = createSolanaRpc(mainnet(getSolanaRpcUrl()));
  const audited = new WeakMap<PreparedTransactionInspection, Readonly<{
    route: ParsedJupiterRoute; maximumAtaRentLamports: bigint; outputTransferFeeBps: number;
  }>>();
  return {
    allowedProgramIds: [COMPUTE_BUDGET_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, JUPITER_V6_PROGRAM],
    allowedWritableAddresses: [],
    minimumOutputRaw,
    maximumNetworkFeeLamports: MAX_MANUAL_NETWORK_FEE_LAMPORTS.toString(),
    maximumAdditionalNativeDebitLamports: MAX_ATA_RENT_LAMPORTS.toString(),
    maximumTokenFeesRaw: {},
    resolveLookupTable: createSolanaLookupTableResolver(),
    getNetworkFeeLamports: createSolanaNetworkFeeReader(),
    async verifyWritableAccounts(inspection, candidate) {
      const trade = tradeEconomics(candidate);
      const route = parseSupportedJupiterRoute(inspection, candidate);
      if (route.sourceTokenAccount === route.destinationTokenAccount) fail("UNAUTHORIZED_ACCOUNT");
      const keys = [...new Set([
        ...inspection.writableAddresses.filter((item) => item !== trade.walletAddress),
        trade.inputMint,
        trade.outputMint,
      ])];
      const response = await rpc.getMultipleAccounts(keys.map((value) => address(value)), {
        commitment: "confirmed", encoding: "jsonParsed",
      }).send({ abortSignal: AbortSignal.timeout(10_000) });
      if (!Array.isArray(response.value) || response.value.length !== keys.length) fail("UNAUTHORIZED_ACCOUNT");
      const accounts = new Map(keys.map((value, index) => [value, response.value[index]]));
      const source = accounts.get(route.sourceTokenAccount);
      const destination = accounts.get(route.destinationTokenAccount);
      const inputMint = assertMintCompatibility(accounts.get(trade.inputMint), trade.inputDecimals);
      const outputMint = assertMintCompatibility(accounts.get(trade.outputMint), trade.outputDecimals);
      const inputMintOwner = inputMint.owner;
      const outputMintOwner = outputMint.owner;
      // Meteora swap2's amount_in is the gross wallet debit: its Token-2022
      // transfer fee is subtracted before the pool swap, not added to that
      // amount (MeteoraAg/dlmm-sdk, commons/src/quote.rs quote_exact_in).
      // This exception is deliberately limited to the reviewed Polymarket
      // mint and the decoded one-leg route_v2 Meteora swap. Unknown input-fee
      // routes cannot claim the same debit semantics.
      const swap = inspection.instructions[route.swapInstructionIndex];
      if (inputMint.transferFeeBps !== 0 &&
          (trade.inputMint !== DEMO_PRESTOCKS_FEE_MINT || route.variant !== "route_v2" ||
           swap.accounts[10]?.address !== METEORA_DLMM_PROGRAM)) {
        fail("TRANSACTION_SEMANTICS_UNVERIFIED");
      }
      const sourceInfo = parsedTokenAccount(source);
      const destinationInfo = parsedTokenAccount(destination);
      if (route.ataCreateInstructionIndex !== null) {
        await verifyCanonicalAssociatedTokenAccountCreation(inspection.instructions[route.ataCreateInstructionIndex], candidate,
          route.destinationTokenAccount, outputMintOwner);
        // Token-2022 account-extension size depends on the live mint. Keep a
        // separate conservative 0.01 SOL owner-debit cap instead of assuming
        // a fixed 170-byte ATA rent value.
      }
      if (!sourceInfo || destination === null && route.ataCreateInstructionIndex === null ||
          destination !== null && !destinationInfo) fail("UNAUTHORIZED_ACCOUNT");
      if (sourceInfo.owner !== trade.walletAddress || sourceInfo.mint !== trade.inputMint ||
          record(source)?.owner !== inputMintOwner || sourceInfo.state !== "initialized" ||
          sourceInfo.isNative !== false || sourceInfo.delegate != null ||
          rawU64(String(record(sourceInfo.tokenAmount)?.amount), "UNAUTHORIZED_ACCOUNT") <
            rawU64(trade.inputAmountRaw, "INVALID_TRANSACTION")) {
        fail("UNAUTHORIZED_ACCOUNT");
      }
      if (destinationInfo && (destinationInfo.owner !== trade.walletAddress ||
          destinationInfo.mint !== trade.outputMint || record(destination)?.owner !== outputMintOwner ||
          destinationInfo.state !== "initialized" || destinationInfo.isNative !== false ||
          destinationInfo.delegate != null)) fail("UNAUTHORIZED_ACCOUNT");
      if (route.variant === "route" && (inputMintOwner !== SPL_TOKEN_PROGRAM_ADDRESS ||
          outputMintOwner !== SPL_TOKEN_PROGRAM_ADDRESS)) fail("UNAUTHORIZED_ACCOUNT");
      if (route.variant === "route_v2" &&
          (swap.accounts[5].address !== inputMintOwner || swap.accounts[6].address !== outputMintOwner)) {
        fail("UNAUTHORIZED_ACCOUNT");
      }
      if (route.variant === "shared_accounts_route" &&
          (inputMintOwner === TOKEN_2022_PROGRAM_ADDRESS || outputMintOwner === TOKEN_2022_PROGRAM_ADDRESS) &&
          swap.accounts[10]?.address !== TOKEN_2022_PROGRAM_ADDRESS) fail("UNAUTHORIZED_ACCOUNT");
      for (const [key, value] of accounts) {
        if (key === trade.inputMint || key === trade.outputMint) continue;
        const owner = record(value)?.owner;
        if (owner === trade.walletAddress) fail("UNAUTHORIZED_ACCOUNT");
        if (owner === SPL_TOKEN_PROGRAM_ADDRESS || owner === TOKEN_2022_PROGRAM_ADDRESS) {
          const info = parsedTokenAccount(value);
          if (!info || info.owner === trade.walletAddress &&
              key !== route.sourceTokenAccount && key !== route.destinationTokenAccount) {
            fail("UNAUTHORIZED_ACCOUNT");
          }
        }
      }
      audited.set(inspection, {
        route,
        maximumAtaRentLamports: route.ataCreateInstructionIndex === null ? 0n : MAX_ATA_RENT_LAMPORTS,
        outputTransferFeeBps: outputMint.transferFeeBps,
      });
    },
    async verifyInstructionEffects(inspection, candidate, verifiedNetworkFeeLamports) {
      const checked = audited.get(inspection);
      const trade = tradeEconomics(candidate);
      if (!checked || Object.entries(expected).some(([key, value]) =>
        trade[key as keyof TradeEconomics] !== value)) fail("TRANSACTION_SEMANTICS_UNVERIFIED");
      return {
        requestId: trade.requestId,
        inputMint: trade.inputMint,
        outputMint: trade.outputMint,
        maximumInputRaw: checked.route.maximumInputRaw,
        // floor(gross * (1 - rate)) is gross minus the rounded-up transfer
        // fee, including the one-base-unit rounding boundary. Ignoring the
        // configured maximum fee only makes this net output floor stricter.
        guaranteedMinimumOutputRaw: (BigInt(checked.route.minimumOutputRaw) *
          BigInt(10_000 - checked.outputTransferFeeBps) / 10_000n).toString(),
        maximumNetworkFeeLamports: verifiedNetworkFeeLamports,
        tokenFees: [], otherTokenDebits: [],
        otherNativeDebitLamports: checked.maximumAtaRentLamports.toString(),
        coveredInstructionIndexes: inspection.instructions.map((_instruction, index) => index),
      };
    },
  };
}

function assertEffects(prepared: PreparedTradeTransaction, policy: PreparedTransactionPolicy, inspection: PreparedTransactionInspection, proof: InstructionEffectProof): NonNullable<PreparedTransactionInspection["effects"]> {
  const trade = tradeEconomics(prepared);
  if (
    !proof || proof.requestId !== trade.requestId ||
    proof.inputMint !== trade.inputMint ||
    proof.outputMint !== trade.outputMint ||
    !Array.isArray(proof.coveredInstructionIndexes) ||
    proof.coveredInstructionIndexes.length !== inspection.instructions.length ||
    proof.coveredInstructionIndexes.some((index, position) => index !== position)
  ) fail("TRANSACTION_SEMANTICS_UNVERIFIED");

  const input = rawU64(trade.inputAmountRaw, "INVALID_TRANSACTION");
  const quoteOutput = rawU64(trade.outputAmountRaw, "INVALID_TRANSACTION");
  const requiredOutput = rawU64(policy.minimumOutputRaw, "TRANSACTION_SEMANTICS_UNVERIFIED");
  const maxNetworkFee = rawU64(policy.maximumNetworkFeeLamports, "TRANSACTION_SEMANTICS_UNVERIFIED");
  const provenInput = rawU64(proof.maximumInputRaw, "TRANSACTION_SEMANTICS_UNVERIFIED");
  const provenOutput = rawU64(proof.guaranteedMinimumOutputRaw, "TRANSACTION_SEMANTICS_UNVERIFIED");
  const provenNetworkFee = rawU64(proof.maximumNetworkFeeLamports, "TRANSACTION_SEMANTICS_UNVERIFIED");
  const provenAdditionalNativeDebit = rawU64(proof.otherNativeDebitLamports, "TRANSACTION_SEMANTICS_UNVERIFIED");
  const maxAdditionalNativeDebit = rawU64(policy.maximumAdditionalNativeDebitLamports ?? "0", "TRANSACTION_SEMANTICS_UNVERIFIED");
  if (!input || !quoteOutput || !requiredOutput || requiredOutput > quoteOutput || !provenInput ||
      provenInput > input || provenOutput < requiredOutput || provenOutput > quoteOutput ||
      provenNetworkFee > maxNetworkFee || provenAdditionalNativeDebit > maxAdditionalNativeDebit ||
      provenNetworkFee + provenAdditionalNativeDebit > MAX_U64) fail("ECONOMIC_LIMIT_EXCEEDED");
  if (!Array.isArray(proof.otherTokenDebits) || proof.otherTokenDebits.length !== 0 || !Array.isArray(proof.tokenFees)) {
    fail("ECONOMIC_LIMIT_EXCEEDED");
  }
  const fees = new Map<string, bigint>();
  for (const fee of proof.tokenFees) {
    const mint = validAddress(fee.mint, "TRANSACTION_SEMANTICS_UNVERIFIED").toString();
    const amount = rawU64(fee.raw, "TRANSACTION_SEMANTICS_UNVERIFIED");
    const total = (fees.get(mint) ?? 0n) + amount;
    if (total > MAX_U64) fail("ECONOMIC_LIMIT_EXCEEDED");
    fees.set(mint, total);
  }
  for (const [mint, amount] of fees) {
    const allowed = policy.maximumTokenFeesRaw[mint];
    if (allowed === undefined || amount > rawU64(allowed, "TRANSACTION_SEMANTICS_UNVERIFIED")) fail("ECONOMIC_LIMIT_EXCEEDED");
  }
  // A fee taken in USDC is part of the wallet's total USDC debit. Checking
  // principal and fee independently would exceed the amount the owner chose.
  if (provenInput + (fees.get(trade.inputMint) ?? 0n) > input) {
    fail("ECONOMIC_LIMIT_EXCEEDED");
  }
  if (trade.feeMint === null ? fees.size !== 0 : [...fees.keys()].some((mint) => mint !== trade.feeMint)) {
    fail("ECONOMIC_LIMIT_EXCEEDED");
  }
  return {
    maximumInputRaw: (provenInput + (fees.get(trade.inputMint) ?? 0n)).toString(),
    requiredMinimumOutputRaw: provenOutput.toString(),
    maximumWalletNativeDebitLamportsRaw: (provenNetworkFee + provenAdditionalNativeDebit).toString(),
  };
}

/**
 * An envelope check is not enough to approve a Jupiter transaction. The function has no
 * permissive default: until a complete route-specific effect verifier is installed, it
 * always rejects before a wallet may be asked to sign.
 */
export async function assertPreparedInvestmentTransaction(
  prepared: PreparedTradeTransaction,
  policy: PreparedTransactionPolicy,
): Promise<PreparedTransactionInspection> {
  if (!policy || !Array.isArray(policy.allowedProgramIds) || !policy.allowedProgramIds.length ||
      !Array.isArray(policy.allowedWritableAddresses) || !policy.verifyInstructionEffects ||
      !policy.getNetworkFeeLamports ||
      (!policy.allowedWritableAddresses.length && !policy.verifyWritableAccounts)) {
    fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  }
  const trade = tradeEconomics(prepared);
  const wallet = validAddress(trade.walletAddress, "INVALID_TRANSACTION").toString();
  validAddress(trade.inputMint, "INVALID_TRANSACTION");
  validAddress(trade.outputMint, "INVALID_TRANSACTION");
  const bytes = canonicalTransactionBytes(trade.transaction);
  let transaction: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  let compiled: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
  try {
    transaction = getTransactionDecoder().decode(bytes);
    compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  } catch { return fail("INVALID_TRANSACTION"); }
  if (compiled.version !== 0 || compiled.header.numSignerAccounts !== 1 ||
      compiled.header.numReadonlySignerAccounts !== 0 || compiled.staticAccounts[0] !== wallet ||
      compiled.header.numReadonlyNonSignerAccounts > compiled.staticAccounts.length - 1 ||
      Object.keys(transaction.signatures).length !== 1 || transaction.signatures[wallet as Address] !== null ||
      compiled.instructions.length === 0 || compiled.instructions.length > MAX_INSTRUCTIONS ||
      compiled.addressTableLookups && compiled.addressTableLookups.length > MAX_LOOKUP_TABLES) {
    fail("INVALID_TRANSACTION");
  }

  const lookups = compiled.addressTableLookups ?? [];
  const lookupTableAddresses = lookups.map(({ lookupTableAddress }) => lookupTableAddress.toString());
  uniqueAddresses(lookupTableAddresses, "UNRESOLVED_LOOKUP_TABLE");
  if (lookups.length && !policy.resolveLookupTable) fail("UNRESOLVED_LOOKUP_TABLE");
  const resolved = {} as Record<Address, Address[]>;
  const loadedWritable: string[] = [];
  const loadedReadonly: string[] = [];
  for (const lookup of lookups) {
    let entries: readonly string[];
    try { entries = await policy.resolveLookupTable!(lookup.lookupTableAddress); }
    catch { return fail("UNRESOLVED_LOOKUP_TABLE"); }
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 256) fail("UNRESOLVED_LOOKUP_TABLE");
    // Solana ALT entries are indexed, not a set. Published tables may contain
    // duplicate addresses at unused indices; only addresses actually selected
    // by this message must be unique (checked in allAddresses below).
    const addresses = entries.map((value) => validAddress(value, "UNRESOLVED_LOOKUP_TABLE"));
    const indices = [...lookup.writableIndexes, ...lookup.readonlyIndexes];
    if (!indices.length || new Set(indices).size !== indices.length || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= addresses.length)) {
      fail("UNRESOLVED_LOOKUP_TABLE");
    }
    resolved[lookup.lookupTableAddress] = addresses;
    loadedWritable.push(...lookup.writableIndexes.map((index) => addresses[index].toString()));
    loadedReadonly.push(...lookup.readonlyIndexes.map((index) => addresses[index].toString()));
  }
  const allAddresses = [
    ...compiled.staticAccounts.map(String),
    ...loadedWritable,
    ...loadedReadonly,
  ];
  if (allAddresses.length > MAX_ACCOUNTS) fail("INVALID_TRANSACTION");
  uniqueAddresses(allAddresses, "UNAUTHORIZED_ACCOUNT");
  if (!allAddresses.includes(trade.inputMint) || !allAddresses.includes(trade.outputMint)) {
    fail("UNAUTHORIZED_ACCOUNT");
  }
  const numSigners = compiled.header.numSignerAccounts;
  const readonlyNonSignersStart = compiled.staticAccounts.length - compiled.header.numReadonlyNonSignerAccounts;
  const writableAddresses = [
    ...compiled.staticAccounts.filter((_value, index) => index < numSigners || index < readonlyNonSignersStart && index >= numSigners).map(String),
    ...loadedWritable,
  ];
  const allowedWritable = uniqueAddresses(policy.allowedWritableAddresses, "TRANSACTION_SEMANTICS_UNVERIFIED");
  allowedWritable.add(wallet);
  if (!policy.verifyWritableAccounts && writableAddresses.some((value) => !allowedWritable.has(value))) fail("UNAUTHORIZED_ACCOUNT");

  let message;
  try { message = decompileTransactionMessage(compiled, { addressesByLookupTableAddress: resolved }); }
  catch { return fail("INVALID_TRANSACTION"); }
  if (!("blockhash" in message.lifetimeConstraint)) fail("INVALID_TRANSACTION");
  const allowedPrograms = uniqueAddresses(policy.allowedProgramIds, "TRANSACTION_SEMANTICS_UNVERIFIED");
  const instructions = message.instructions.map((instruction): ResolvedInstruction => ({
    programAddress: instruction.programAddress.toString(),
    accounts: (instruction.accounts ?? []).map((account) => ({
      address: account.address.toString(),
      writable: isWritableRole(account.role),
      signer: account.role >= 2,
    })),
    data: Uint8Array.from(instruction.data ?? []),
  }));
  if (instructions.length !== compiled.instructions.length ||
      instructions.some((instruction) => !allowedPrograms.has(instruction.programAddress) || !allAddresses.includes(instruction.programAddress))) {
    fail("UNAUTHORIZED_PROGRAM");
  }
  const inspection: PreparedTransactionInspection = {
    feePayer: wallet,
    allAddresses,
    writableAddresses,
    lookupTableAddresses,
    instructions,
  };
  if (policy.verifyWritableAccounts) {
    try { await policy.verifyWritableAccounts(inspection, prepared); }
    catch { return fail("UNAUTHORIZED_ACCOUNT"); }
  }
  let networkFee: bigint;
  try {
    const reencodedMessage = getCompiledTransactionMessageEncoder().encode(compiled);
    if (!Buffer.from(reencodedMessage).equals(Buffer.from(transaction.messageBytes))) fail("INVALID_TRANSACTION");
    const serializedMessage = Buffer.from(reencodedMessage).toString("base64");
    networkFee = rawU64(await policy.getNetworkFeeLamports(serializedMessage), "TRANSACTION_SEMANTICS_UNVERIFIED");
  } catch { return fail("TRANSACTION_SEMANTICS_UNVERIFIED"); }
  let proof: InstructionEffectProof;
  try { proof = await policy.verifyInstructionEffects(inspection, prepared, networkFee.toString()); }
  catch { return fail("TRANSACTION_SEMANTICS_UNVERIFIED"); }
  if (rawU64(proof.maximumNetworkFeeLamports, "TRANSACTION_SEMANTICS_UNVERIFIED") !== networkFee) {
    fail("TRANSACTION_SEMANTICS_UNVERIFIED");
  }
  const effects = assertEffects(prepared, policy, inspection, proof);
  return { ...inspection, effects };
}
