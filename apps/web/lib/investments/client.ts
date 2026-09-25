import type { InvestmentExecutionResponse, PreparedInvestmentResponse } from "./types";

export class InvestmentClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly submissionStatus?: "NOT_SUBMITTED",
  ) {
    super(message);
    this.name = "InvestmentClientError";
  }
}

export function classifyInvestmentApprovalError(error: unknown, signed: boolean): "status-unknown" | "wallet-rejected" | "failure" {
  // A wallet rejection can only be assumed before a signed transaction exists.
  // After signing, even an AbortError may mean the provider received the bytes.
  if (signed) return "status-unknown";
  if (typeof error === "object" && error !== null && (
    ("name" in error && error.name === "AbortError") ||
    ("code" in error && error.code === 4001)
  )) return "wallet-rejected";
  return "failure";
}

export function decodeBase64Transaction(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (!bytes.length || btoa(binary) !== value) throw new Error("Invalid base64 transaction");
    return bytes;
  } catch {
    throw new InvestmentClientError("TRANSACTION_MISMATCH", "The prepared transaction is not valid.");
  }
}

export function encodeBase64Transaction(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function readInvestmentApiResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: unknown; message?: unknown; submissionStatus?: unknown } }).error
      : undefined;
    throw new InvestmentClientError(
      typeof error?.code === "string" ? error.code : "PROVIDER_UNAVAILABLE",
      typeof error?.message === "string" ? error.message : "StockPilot could not complete this investment.",
      error?.submissionStatus === "NOT_SUBMITTED" ? "NOT_SUBMITTED" : undefined,
    );
  }
  return body as T;
}

export async function runInvestmentApproval(input: {
  prepared: PreparedInvestmentResponse;
  connectedWalletAddress: string;
  sessionWalletAddress: string;
  sign: (transaction: Uint8Array) => Promise<Uint8Array>;
  execute: (signedTransaction: string, investmentToken: string) => Promise<InvestmentExecutionResponse>;
  refreshPortfolio: () => Promise<void>;
  onPortfolioRefreshError?: (error: unknown) => void;
  onSigned?: () => void;
}): Promise<InvestmentExecutionResponse> {
  if (
    input.connectedWalletAddress !== input.sessionWalletAddress ||
    input.prepared.investment.walletAddress !== input.sessionWalletAddress
  ) {
    throw new InvestmentClientError("WALLET_MISMATCH", "The connected wallet does not match your authenticated session.");
  }
  const signed = await input.sign(decodeBase64Transaction(input.prepared.transaction));
  input.onSigned?.();
  const result = await input.execute(
    encodeBase64Transaction(signed),
    input.prepared.investmentToken,
  );
  if (result.execution.status === "CONFIRMED") {
    try {
      await input.refreshPortfolio();
    } catch (error) {
      input.onPortfolioRefreshError?.(error);
    }
  }
  return result;
}
