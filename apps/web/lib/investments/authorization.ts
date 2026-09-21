import "server-only";

import {
  address,
  getTransactionDecoder,
  getTransactionVersionDecoder,
} from "@solana/kit";
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
  walletAddress: string;
  requestId: string;
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  outputDecimals: number;
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
  if (!transaction.signatures[address(wallet)]) {
    throw new InvestmentSecurityError("WALLET_MISMATCH", "The authenticated wallet did not sign this investment.");
  }
}

function isAuthorization(value: unknown): value is InvestmentAuthorization {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<InvestmentAuthorization>;
  return token.kind === "investment" &&
    typeof token.walletAddress === "string" &&
    typeof token.requestId === "string" && token.requestId.length > 0 &&
    typeof token.inputMint === "string" &&
    typeof token.outputMint === "string" &&
    typeof token.inputAmountRaw === "string" && /^\d+$/.test(token.inputAmountRaw) &&
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

export async function createInvestmentAuthorization(input: Omit<InvestmentAuthorization, "kind" | "createdAt" | "expiresAt" | "messageFingerprint"> & {
  transaction: string;
}, secret: string, now = Date.now()): Promise<string> {
  const token: InvestmentAuthorization = {
    kind: "investment",
    walletAddress: address(input.walletAddress).toString(),
    requestId: input.requestId,
    inputMint: address(input.inputMint).toString(),
    outputMint: address(input.outputMint).toString(),
    inputAmountRaw: input.inputAmountRaw,
    outputDecimals: input.outputDecimals,
    symbol: input.symbol,
    messageFingerprint: await fingerprintTransactionMessage(input.transaction),
    lastValidBlockHeight: input.lastValidBlockHeight,
    orderExpireAt: input.orderExpireAt,
    createdAt: now,
    expiresAt: tokenExpiry(now, input.orderExpireAt),
  };
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
