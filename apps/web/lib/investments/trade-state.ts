import { InvestmentClientError, readInvestmentApiResponse } from "./client";
import type { ActiveManualInvestmentStatusResponse, InvestmentExecutionResponse, ManualInvestmentStatusResponse } from "./types";

export type TradeExecution = Omit<InvestmentExecutionResponse["execution"], "status"> & {
  status: InvestmentExecutionResponse["execution"]["status"] | "REVIEW_REQUIRED";
};

export function statusExecution(result: ManualInvestmentStatusResponse["execution"]): TradeExecution {
  return {
    ...result,
    status: ["CONFIRMED", "FAILED", "REJECTED", "REVIEW_REQUIRED"].includes(result.status)
      ? result.status as TradeExecution["status"] : "PENDING",
    side: result.side ?? "BUY",
    solscanUrl: `https://solscan.io/tx/${encodeURIComponent(result.transactionSignature)}`,
  };
}

export function tradeStatusLabel(status: TradeExecution["status"]): string {
  switch (status) {
    case "CONFIRMED": return "Trade complete";
    case "FAILED": return "Failed on Solana";
    case "REJECTED": return "Not submitted. Review a fresh quote.";
    case "REVIEW_REQUIRED": return "Transaction needs review. Do not resubmit.";
    default: return "Confirming on Solana…";
  }
}

/** Only use after the server explicitly proves NOT_SUBMITTED, never for an unknown outcome. */
export function notSubmittedTradeMessage(error: InvestmentClientError): string {
  if (error.code === "JUPITER_ORDER_EXPIRED" || error.code === "INVESTMENT_TOKEN_EXPIRED") {
    return "Quote expired. No transaction was sent. Review a new quote.";
  }
  return `${error.message} No transaction was sent.`;
}

export async function readTradeStatus(requestId: string | null, signal: AbortSignal, fetcher = fetch) {
  const response = await fetcher("/api/investments/manual/status", {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
    cache: "no-store", signal,
    body: JSON.stringify(requestId ? { providerRequestId: requestId } : { active: true }),
  });
  const result = await readInvestmentApiResponse<ActiveManualInvestmentStatusResponse>(response);
  // A missing receipt is not evidence that an already-signed trade was not sent.
  if (!result || !("execution" in result) || (requestId && !result.execution)) throw new Error("Trade status unavailable");
  if (result.execution && (requestId && result.execution.providerRequestId !== requestId ||
    !["CLAIMED", "SUBMITTED", "UNKNOWN", "CONFIRMED", "FAILED", "REJECTED", "REVIEW_REQUIRED"].includes(result.execution.status))) {
    throw new Error("Unexpected trade status");
  }
  return result.execution ? statusExecution(result.execution) : null;
}

/** Polls receipts only. It has no signing, preparation, or execution capability. */
export function pollTradeStatus(options: {
  requestId: string | null;
  onResult: (result: TradeExecution | null) => void;
  onError: () => void;
  fetcher?: typeof fetch;
}) {
  let stopped = false;
  let requestId = options.requestId;
  let attempts = 0;
  let next: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController;
  const poll = async () => {
    controller = new AbortController();
    deadline = setTimeout(() => controller.abort(), 20_000);
    let repeat = true;
    try {
      const result = await readTradeStatus(requestId, controller.signal, options.fetcher);
      if (stopped) return;
      if (result) requestId = result.providerRequestId;
      options.onResult(result);
      repeat = result?.status === "PENDING";
    } catch {
      if (!stopped) options.onError();
    } finally {
      clearTimeout(deadline);
      if (!stopped && repeat) next = setTimeout(() => void poll(), Math.min(++attempts * 5_000, 30_000));
    }
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(next);
    clearTimeout(deadline);
    controller?.abort();
  };
}

export type SellHolding = { amount: string; displayAmount: string | null; scaled: boolean };

export async function readSellHolding(response: Response, walletAddress: string, mintAddress: string): Promise<SellHolding> {
  const body = await readInvestmentApiResponse<{ portfolio?: {
    walletAddress?: string; positions?: { mintAddress: string; rawTokenAmount?: string; decimals?: number;
      quantity?: string | null; displayStatus?: string }[]; unrecognizedTokenMintCount?: number;
  } }>(response);
  const portfolio = body?.portfolio;
  if (portfolio?.walletAddress !== walletAddress || !Array.isArray(portfolio.positions) ||
    portfolio.positions.some((item) => !item || typeof item.mintAddress !== "string")) throw new Error("Balance unavailable");
  const matches = portfolio.positions.filter((item) => item.mintAddress === mintAddress);
  if (!matches.length) {
    if (portfolio.unrecognizedTokenMintCount) throw new Error("Balance unavailable");
    return { amount: "0", displayAmount: "0", scaled: false };
  }
  const position = matches[0];
  const { rawTokenAmount: raw, decimals } = position;
  if (matches.length !== 1 || typeof raw !== "string" || !/^\d{1,20}$/.test(raw) ||
    BigInt(raw) > 18_446_744_073_709_551_615n || typeof decimals !== "number" ||
    !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Balance unavailable");
  // Preserve exact base units. In particular, never put an xStock's scaled display quantity into a SELL order.
  const padded = BigInt(raw).toString().padStart(decimals + 1, "0");
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  const amount = decimals ? `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}` : padded;
  const scaled = position.displayStatus === "RPC_SCALED" || position.displayStatus === "MULTIPLIER_UNVERIFIED";
  const displayAmount = scaled ? typeof position.quantity === "string" && /^\d+(\.\d+)?$/.test(position.quantity)
    ? position.quantity : null : amount;
  return { amount, displayAmount, scaled };
}
