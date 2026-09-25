import "server-only";

import { createHash } from "node:crypto";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import type { PreparedInvestment } from "@stockpilot/core/investments";
import type { PreparedManualSell } from "@stockpilot/core/manual-sell";
import type { PreparedXStocksBuy } from "@stockpilot/core/xstocks-manual-buy";
import { formatRawTokenAmount } from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { assembleJupiterBuildTransaction, JupiterV2Adapter } from "@stockpilot/integrations/jupiter-v2";
import { marketRegistry } from "@/lib/markets";
import { createSolanaReadAdapter } from "@/lib/solana/read-adapter";
import { InvestmentApiError } from "./errors";
import { assertPreparedInvestmentTransaction, createManualTradeValidationPolicy } from "./transaction-validation";

const PRESTOCKS_MINT = "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP";
const XSTOCKS_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const MAX_CATALOG_AGE_MS = 60_000;
const MAX_QUOTE_MS = 60_000;
const solana = createSolanaReadAdapter();

export type DemoTradeRequest = {
  side: "BUY" | "SELL";
  provider: "prestocks" | "xstocks";
  mintAddress: string;
  amount: string;
  /** An explicit statement by the signed-in demo owner, not a legal determination. */
  eligibleNonUsAttestation: true;
};

export function demoTradeProductSupported(provider: DemoTradeRequest["provider"], mintAddress: string): boolean {
  return provider === "prestocks" ? mintAddress === PRESTOCKS_MINT : mintAddress === XSTOCKS_MINT;
}

export function demoWalletAllowed(walletAddress: string): boolean {
  const allowed = process.env.STOCKPILOT_DEMO_TRADER_WALLET?.trim();
  return Boolean(allowed && allowed === walletAddress);
}

export function parseDemoTradeRequest(value: unknown): DemoTradeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvestmentApiError("INVALID_REQUEST", 400);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "amount,eligibleNonUsAttestation,mintAddress,provider,side" ||
      (row.side !== "BUY" && row.side !== "SELL") ||
      (row.provider !== "prestocks" && row.provider !== "xstocks") ||
      typeof row.mintAddress !== "string" || typeof row.amount !== "string" ||
      row.amount.length > 40 || row.eligibleNonUsAttestation !== true) {
    throw new InvestmentApiError("INVALID_REQUEST", 400);
  }
  return row as DemoTradeRequest;
}

/** Exact user-entered amount; balance and route checks apply separately. */
export function parseDemoTradeAmount(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) throw new InvestmentApiError("INVALID_AMOUNT", 400);
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) throw new InvestmentApiError("INVALID_AMOUNT", 400);
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n || raw > 18_446_744_073_709_551_615n) throw new InvestmentApiError("INVALID_AMOUNT", 400);
  return raw;
}

export async function resolveDemoAsset(provider: DemoTradeRequest["provider"], mintAddress: string): Promise<InvestmentAsset> {
  if (!demoTradeProductSupported(provider, mintAddress)) {
    throw new InvestmentApiError("ASSET_NOT_ALLOWED", 403);
  }
  const snapshot = await marketRegistry.getSnapshot(provider);
  const source = snapshot.sources.filter((item) => item.provider === provider);
  const fetchedAt = source.length === 1 ? Date.parse(source[0].fetchedAt) : Number.NaN;
  if (snapshot.stale || source.length !== 1 || source[0].stale || !Number.isFinite(fetchedAt) ||
      fetchedAt > Date.now() + 5_000 || Date.now() - fetchedAt > MAX_CATALOG_AGE_MS) {
    throw new InvestmentApiError("ASSET_CATALOG_STALE", 503);
  }
  const matches = snapshot.assets.filter((item) => item.id === `${provider}:${mintAddress}`);
  const asset = matches[0];
  if (matches.length !== 1 || !asset || asset.canonical !== true || asset.provider !== provider ||
      asset.mintAddress !== mintAddress || provider === "xstocks" &&
      (asset.metadata?.isTradingHalted !== false || !["PUBLIC_EQUITY", "ETF"].includes(asset.marketType))) {
    throw new InvestmentApiError("ASSET_NOT_ALLOWED", 403);
  }
  return asset;
}

/** Owner-only, two-asset manual trade. It never signs or sends a transaction. */
export async function prepareDemoTrade(walletAddress: string, principalId: string, request: DemoTradeRequest) {
  if (!demoWalletAllowed(walletAddress) || !principalId) throw new InvestmentApiError("ASSET_NOT_ALLOWED", 403);
  const asset = await resolveDemoAsset(request.provider, request.mintAddress);
  const decimals = await solana.getTokenDecimals(asset.mintAddress);
  const balances = await solana.getTokenBalances(walletAddress);
  let inputRaw: bigint;
  let inputMint: string;
  let outputMint: string;
  let inputDecimals: number;
  let outputDecimals: number;
  if (request.side === "BUY") {
    inputRaw = parseDemoTradeAmount(request.amount, 6);
    inputMint = SOLANA_MAINNET_USDC_MINT;
    outputMint = asset.mintAddress;
    inputDecimals = 6;
    outputDecimals = decimals;
  } else {
    inputRaw = parseDemoTradeAmount(request.amount, decimals);
    inputMint = asset.mintAddress;
    outputMint = SOLANA_MAINNET_USDC_MINT;
    inputDecimals = decimals;
    outputDecimals = 6;
  }
  const available = balances.filter((entry) => entry.mintAddress === inputMint)
    .reduce((total, entry) => total + BigInt(entry.rawAmount), 0n);
  if (inputRaw > available) throw new InvestmentApiError(request.side === "BUY" ? "INSUFFICIENT_USDC" : "INVALID_AMOUNT", 409);
  const dex = request.provider === "prestocks" ? "Meteora DLMM" : "Raydium CLMM";
  const build = await new JupiterV2Adapter(process.env.JUPITER_API_KEY?.trim() || null).build({
    inputMint, outputMint, amountRaw: inputRaw.toString(), taker: walletAddress,
    slippageBps: 100, directDex: dex,
  });
  const transaction = assembleJupiterBuildTransaction(build, walletAddress);
  const requestId = `build:${createHash("sha256").update(transaction).digest("hex")}`;
  const now = Date.now();
  const expiresAt = new Date(now + MAX_QUOTE_MS).toISOString();
  const common = {
    walletAddress, transaction, requestId, lastValidBlockHeight: String(build.blockhashWithMetadata.lastValidBlockHeight),
    router: dex, mode: "manual", feeBps: 0, feeMint: null, priceImpactPct: build.priceImpactPct,
  };
  const prepared: PreparedInvestment | PreparedXStocksBuy | PreparedManualSell = request.side === "SELL"
    ? { ...common, assetId: asset.id, provider: request.provider, principalId,
      inputMint: asset.mintAddress, outputMint: SOLANA_MAINNET_USDC_MINT,
      inputRaw: inputRaw.toString(), inputDecimals: decimals, inputUnits: "RAW_TOKEN_BASE_UNITS",
      quotedUsdcOutRaw: build.outAmount,
      requiredMinimumUsdcOutRaw: (BigInt(build.outAmount) * 99n / 100n).toString(),
      expiresAt, transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION" }
    : request.provider === "xstocks"
      ? { ...common, assetId: asset.id, principalId,
        inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: asset.mintAddress,
        inputRaw: inputRaw.toString(), quotedOutputRaw: build.outAmount,
        requiredMinimumOutputRaw: (BigInt(build.outAmount) * 99n / 100n).toString(),
        outputDecimals: decimals, outputUnits: "RAW_TOKEN_2022_BASE_UNITS",
        expiresAt, transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION" }
      : { ...common, asset: { symbol: asset.symbol, name: asset.name, mintAddress: asset.mintAddress },
        fundingAsset: { symbol: "USDC", mintAddress: SOLANA_MAINNET_USDC_MINT },
        inputAmountRaw: inputRaw.toString(), inputAmountUsd: request.amount,
        outputAmountRaw: build.outAmount, outputDecimals: decimals,
        expireAt: expiresAt, createdAt: new Date(now).toISOString() };
  const inspection = await assertPreparedInvestmentTransaction(prepared, createManualTradeValidationPolicy(prepared));
  if (!inspection.effects) throw new InvestmentApiError("INVESTMENT_ORDER_UNVERIFIED", 503);
  return {
    prepared, asset,
    effects: inspection.effects,
    review: {
      requestId, side: request.side, provider: request.provider, symbol: asset.symbol, name: asset.name,
      walletAddress, inputMint, outputMint, inputAmountRaw: inputRaw.toString(),
      inputAmount: formatRawTokenAmount(inputRaw.toString(), inputDecimals),
      estimatedOutputAmount: formatRawTokenAmount(build.outAmount, outputDecimals),
      minimumOutputAmount: formatRawTokenAmount(inspection.effects.requiredMinimumOutputRaw, outputDecimals),
      requiredMinimumOutputRaw: inspection.effects.requiredMinimumOutputRaw,
      maximumWalletNativeDebitLamportsRaw: inspection.effects.maximumWalletNativeDebitLamportsRaw,
      priceImpactPct: build.priceImpactPct, router: dex, expiresAt,
    },
  };
}
