import "server-only";

import { InvestmentService } from "@stockpilot/core/investments";
import { JupiterV2Adapter } from "@stockpilot/integrations/jupiter-v2";
import { assetService } from "@/lib/assets";
import { getPortfolio } from "@/lib/portfolio";
import { createSolanaReadAdapter } from "@/lib/solana/read-adapter";
import { getSolanaRpcUrl } from "@/lib/solana/read-adapter";
import { assertFreshPreStocksSymbol } from "./trade-asset";

export type PreflightRejectedExecution = {
  status: "Rejected";
  code: -32002;
};

const solana = createSolanaReadAdapter();
let cachedKey: string | null | undefined;
let cachedJupiter: JupiterV2Adapter | undefined;
let cachedInvestment: InvestmentService | undefined;

function jupiter(): JupiterV2Adapter {
  // Jupiter documents a keyless tier. A server-side key is optional and raises
  // the rate limit; neither mode is authorization to submit a BUY.
  const apiKey = process.env.JUPITER_API_KEY?.trim() || null;
  if (!cachedJupiter || cachedKey !== apiKey) {
    cachedKey = apiKey;
    cachedJupiter = new JupiterV2Adapter(apiKey);
    cachedInvestment = undefined;
  }
  return cachedJupiter;
}

function investments(): InvestmentService {
  return cachedInvestment ??= new InvestmentService(
    assetService,
    { getPortfolio },
    solana,
    jupiter(),
  );
}

export async function prepareInvestment(input: { walletAddress: string; symbol: string; amountUsd: string }) {
  // Product review must precede the Jupiter quote and any wallet-signing UI.
  await assertFreshPreStocksSymbol(input.symbol);
  return investments().prepare(input);
}

export async function executeInvestment(input: { signedTransaction: string; requestId: string; lastValidBlockHeight?: string }) {
  if (!/^build:[a-f0-9]{64}$/.test(input.requestId)) return jupiter().execute(input);
  // Jupiter /build is not compatible with /execute. The durable ledger claims
  // the exact signed message before this single RPC submission. Never retry
  // an ambiguous response; reconciliation reads the signature on chain. The
  // node may forward the SAME signed bytes to leaders up to five more times.
  const response = await fetch(getSolanaRpcUrl(), {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction",
      params: [input.signedTransaction, { encoding: "base64", skipPreflight: false,
        preflightCommitment: "confirmed", maxRetries: 5 }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Solana submission was not acknowledged.");
  const payload: unknown = await response.json();
  const row = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : null;
  const rpcError = row?.error && typeof row.error === "object" && !Array.isArray(row.error)
    ? row.error as Record<string, unknown> : null;
  // -32002 acknowledges that preflight simulation rejected this submission.
  // It is distinct from a lost response and from a failed on-chain transaction.
  // Do not persist provider logs (which can contain transaction/account data).
  if (row?.jsonrpc === "2.0" && row.id === 1 && !Object.hasOwn(row, "result") &&
      rpcError?.code === -32002 && typeof rpcError.message === "string") {
    return { status: "Rejected", code: -32002 } as const satisfies PreflightRejectedExecution;
  }
  if (!row || typeof row.result !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(row.result)) {
    throw new Error("Solana submission is unresolved.");
  }
  return { status: "Success" as const, signature: row.result, code: null, error: null,
    totalInputAmount: null, totalOutputAmount: null };
}

export function getInvestmentBlockHeight() {
  return solana.getCurrentBlockHeight();
}
