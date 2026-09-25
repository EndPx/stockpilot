import "server-only";

import {
  address,
  getAddressEncoder,
  getTransactionDecoder,
  getSignatureFromTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionVersionDecoder,
} from "@solana/kit";
import { SOLANA_MAINNET_USDC_DECIMALS, SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { createSignedToken, readSignedToken } from "@/lib/auth/tokens";

export const INVESTMENT_TOKEN_TTL_MS = 2 * 60_000;
const MAX_TRANSACTION_BYTES = 2_048;

export type InvestmentSecurityErrorCode =
  | "INVESTMENT_TOKEN_INVALID"
  | "INVESTMENT_TOKEN_EXPIRED"
  | "JUPITER_ORDER_EXPIRED"
  | "TRANSACTION_MISMATCH"
  | "WALLET_MISMATCH";

export class InvestmentSecurityError extends Error {
  constructor(readonly code: InvestmentSecurityErrorCode, message: string) {
    super(message);
    this.name = "InvestmentSecurityError";
  }
}

export type InvestmentAuthorization = {
  kind: "investment";
  /** Legacy tokens without a side are BUY only. New tokens bind the exact direction. */
  side?: "BUY" | "SELL";
  /** Legacy BUY tokens without a provider refer only to PreStocks. */
  provider?: "prestocks" | "xstocks";
  walletAddress: string;
  requestId: string;
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  /** Null until a verified instruction-level minimum is bound to the exact order. */
  requiredMinimumOutputRaw: string | null;
  /** Null until an instruction-level verifier binds an owner-approved SOL debit cap. */
  maximumWalletNativeDebitLamportsRaw: string | null;
  outputDecimals: number;
  inputDecimals?: number;
  symbol: string;
  messageFingerprint: string;
  lastValidBlockHeight: string | null;
  orderExpireAt: string | null;
  createdAt: number;
  expiresAt: number;
};

function transactionBytes(serialized: string): Uint8Array {
  if (typeof serialized !== "string" || serialized.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(serialized)) {
    throw new InvestmentSecurityError("TRANSACTION_MISMATCH", "The investment transaction is not valid.");
  }
  const bytes = new Uint8Array(Buffer.from(serialized, "base64"));
  if (
    bytes.length === 0 ||
    bytes.length > MAX_TRANSACTION_BYTES ||
    Buffer.from(bytes).toString("base64") !== serialized
  ) {
    throw new InvestmentSecurityError("TRANSACTION_MISMATCH", "The investment transaction is not valid.");
  }
  return bytes;
}

function decodeTransaction(serialized: string) {
  try {
    const transaction = getTransactionDecoder().decode(transactionBytes(serialized));
    if (getTransactionVersionDecoder().decode(transaction.messageBytes) !== 0) {
      throw new Error("Expected a version zero transaction.");
    }
    return transaction;
  } catch (cause) {
    if (cause instanceof InvestmentSecurityError) throw cause;
    throw new InvestmentSecurityError("TRANSACTION_MISMATCH", "The investment transaction is not valid.");
  }
}

async function hashMessage(messageBytes: ArrayLike<number>): Promise<string> {
  const copy = Uint8Array.from(messageBytes);
  return Buffer.from(await crypto.subtle.digest("SHA-256", copy.buffer)).toString("base64url");
}

export async function fingerprintTransactionMessage(serialized: string): Promise<string> {
  return hashMessage(decodeTransaction(serialized).messageBytes);
}

export async function assertSignedInvestmentTransaction(
  serialized: string,
  walletAddress: string,
  expectedFingerprint: string,
): Promise<void> {
  const transaction = decodeTransaction(serialized);
  if (await hashMessage(transaction.messageBytes) !== expectedFingerprint) {
    throw new InvestmentSecurityError("TRANSACTION_MISMATCH", "The signed transaction does not match the reviewed investment.");
  }
  let wallet: string;
  try {
    wallet = address(walletAddress).toString();
  } catch {
    throw new InvestmentSecurityError("WALLET_MISMATCH", "The connected wallet does not match this investment.");
  }
  const signature = transaction.signatures[address(wallet)];
  if (!signature) {
    throw new InvestmentSecurityError("WALLET_MISMATCH", "The authenticated wallet did not sign this investment.");
  }
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(getAddressEncoder().encode(address(wallet))), { name: "Ed25519" }, false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, Uint8Array.from(signature), Uint8Array.from(transaction.messageBytes))) {
    throw new InvestmentSecurityError("WALLET_MISMATCH", "The authenticated wallet signature is not valid.");
  }
}

/** The fee-payer signature is the on-chain transaction ID; never accept it from the request body. */
export function signedInvestmentSignature(serialized: string, walletAddress: string): string {
  try {
    const transaction = decodeTransaction(serialized);
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (message.staticAccounts[0] !== address(walletAddress)) throw new Error("Fee payer changed.");
    return getSignatureFromTransaction(transaction);
  } catch {
    throw new InvestmentSecurityError("TRANSACTION_MISMATCH", "The signed investment transaction has no fee-payer signature.");
  }
}

function isAuthorization(value: unknown): value is InvestmentAuthorization {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<InvestmentAuthorization>;
  return token.kind === "investment" &&
    (token.side === undefined || token.side === "BUY" || token.side === "SELL") &&
    (token.provider === undefined || token.provider === "prestocks" || token.provider === "xstocks") &&
    typeof token.walletAddress === "string" &&
    typeof token.requestId === "string" && token.requestId.length > 0 &&
    typeof token.inputMint === "string" &&
    typeof token.outputMint === "string" &&
    typeof token.inputAmountRaw === "string" && /^\d+$/.test(token.inputAmountRaw) &&
    (token.requiredMinimumOutputRaw === null ||
      (typeof token.requiredMinimumOutputRaw === "string" &&
        /^[1-9]\d{0,19}$/.test(token.requiredMinimumOutputRaw) &&
        BigInt(token.requiredMinimumOutputRaw) <= 18_446_744_073_709_551_615n)) &&
    (token.maximumWalletNativeDebitLamportsRaw === null ||
      (typeof token.maximumWalletNativeDebitLamportsRaw === "string" &&
        /^[1-9]\d{0,19}$/.test(token.maximumWalletNativeDebitLamportsRaw) &&
        BigInt(token.maximumWalletNativeDebitLamportsRaw) <= 18_446_744_073_709_551_615n)) &&
    (token.inputDecimals === undefined ||
      (typeof token.inputDecimals === "number" && Number.isInteger(token.inputDecimals) &&
        token.inputDecimals >= 0 && token.inputDecimals <= 255)) &&
    typeof token.outputDecimals === "number" && Number.isInteger(token.outputDecimals) &&
    typeof token.symbol === "string" && token.symbol.length > 0 &&
    typeof token.messageFingerprint === "string" && /^[A-Za-z0-9_-]{43}$/.test(token.messageFingerprint) &&
    (token.lastValidBlockHeight === null || (typeof token.lastValidBlockHeight === "string" && /^\d+$/.test(token.lastValidBlockHeight))) &&
    (token.orderExpireAt === null || typeof token.orderExpireAt === "string") &&
    typeof token.createdAt === "number" && Number.isFinite(token.createdAt) &&
    typeof token.expiresAt === "number" && Number.isFinite(token.expiresAt);
}

function tokenExpiry(now: number, orderExpireAt: string | null): number {
  const normalExpiry = now + INVESTMENT_TOKEN_TTL_MS;
  if (!orderExpireAt) return normalExpiry;
  const orderExpiry = Date.parse(orderExpireAt);
  if (!Number.isFinite(orderExpiry) || orderExpiry <= now) {
    throw new InvestmentSecurityError("JUPITER_ORDER_EXPIRED", "The investment quote expired. Prepare a new review.");
  }
  return Math.min(normalExpiry, orderExpiry);
}

function assertTradeDirection(token: InvestmentAuthorization): void {
  const side = token.side ?? "BUY";
  if (side === "SELL" && !token.provider ||
    side === "BUY" && (token.inputMint !== SOLANA_MAINNET_USDC_MINT ||
      (token.inputDecimals ?? SOLANA_MAINNET_USDC_DECIMALS) !== SOLANA_MAINNET_USDC_DECIMALS) ||
    side === "SELL" && (token.outputMint !== SOLANA_MAINNET_USDC_MINT ||
      token.outputDecimals !== SOLANA_MAINNET_USDC_DECIMALS || token.inputDecimals === undefined) ||
    token.inputMint === token.outputMint) {
    throw new InvestmentSecurityError("INVESTMENT_TOKEN_INVALID", "This investment direction is not valid.");
  }
}

export async function createInvestmentAuthorization(input: Omit<InvestmentAuthorization, "kind" | "createdAt" | "expiresAt" | "messageFingerprint"> & {
  transaction: string;
}, secret: string, now = Date.now()): Promise<string> {
  const token: InvestmentAuthorization = {
    kind: "investment",
    side: input.side ?? "BUY",
    provider: input.provider ?? (input.side === "SELL" ? undefined : "prestocks"),
    walletAddress: address(input.walletAddress).toString(),
    requestId: input.requestId,
    inputMint: address(input.inputMint).toString(),
    outputMint: address(input.outputMint).toString(),
    inputAmountRaw: input.inputAmountRaw,
    requiredMinimumOutputRaw: input.requiredMinimumOutputRaw,
    maximumWalletNativeDebitLamportsRaw: input.maximumWalletNativeDebitLamportsRaw,
    outputDecimals: input.outputDecimals,
    inputDecimals: input.inputDecimals ?? SOLANA_MAINNET_USDC_DECIMALS,
    symbol: input.symbol,
    messageFingerprint: await fingerprintTransactionMessage(input.transaction),
    lastValidBlockHeight: input.lastValidBlockHeight,
    orderExpireAt: input.orderExpireAt,
    createdAt: now,
    expiresAt: tokenExpiry(now, input.orderExpireAt),
  };
  if (!isAuthorization(token)) {
    throw new InvestmentSecurityError("INVESTMENT_TOKEN_INVALID", "This investment authorization is not valid.");
  }
  assertTradeDirection(token);
  return createSignedToken(token, secret);
}

export async function readInvestmentAuthorization(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<InvestmentAuthorization> {
  let value: unknown;
  try {
    value = await readSignedToken(token, secret);
  } catch {
    throw new InvestmentSecurityError("INVESTMENT_TOKEN_INVALID", "This investment authorization is not valid.");
  }
  if (!isAuthorization(value)) {
    throw new InvestmentSecurityError("INVESTMENT_TOKEN_INVALID", "This investment authorization is not valid.");
  }
  if (value.expiresAt <= now) {
    throw new InvestmentSecurityError("INVESTMENT_TOKEN_EXPIRED", "This investment authorization expired. Prepare a new review.");
  }
  try {
    address(value.walletAddress);
    address(value.inputMint);
    address(value.outputMint);
    assertTradeDirection(value);
  } catch {
    throw new InvestmentSecurityError("INVESTMENT_TOKEN_INVALID", "This investment authorization is not valid.");
  }
  return value;
}

export function assertAuthorizationWallet(token: InvestmentAuthorization, walletAddress: string): void {
  if (token.walletAddress !== walletAddress) {
    throw new InvestmentSecurityError("WALLET_MISMATCH", "The authenticated wallet does not match this investment.");
  }
}

export function assertOrderStillValid(
  token: InvestmentAuthorization,
  currentBlockHeight: bigint | null,
  now = Date.now(),
): void {
  if (token.orderExpireAt && Date.parse(token.orderExpireAt) <= now) {
    throw new InvestmentSecurityError("JUPITER_ORDER_EXPIRED", "The investment quote expired. Prepare a new review.");
  }
  if (token.lastValidBlockHeight !== null) {
    if (currentBlockHeight === null || currentBlockHeight > BigInt(token.lastValidBlockHeight)) {
      throw new InvestmentSecurityError("JUPITER_ORDER_EXPIRED", "The investment quote expired. Prepare a new review.");
    }
  }
}
