/**
 * Read-only BUY + SELL simulation against the wallet's real current accounts.
 * No private key, signature, account overrides, or sendTransaction call exists.
 * Combined bytes are a diagnostic fixture; production still submits one trade.
 */
import { createHash } from "node:crypto";
import type { PreparedInvestment } from "@stockpilot/core/investments";
import type { PreparedManualSell } from "@stockpilot/core/manual-sell";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { assembleJupiterBuildTransaction, JupiterV2Adapter, type JupiterBuild } from "@stockpilot/integrations/jupiter-v2";
import { parseSupportedJupiterRoute, type PreparedTransactionInspection } from "../lib/investments/transaction-validation";
import { createSolanaReadAdapter, getSolanaRpcUrl } from "../lib/solana/read-adapter";

const wallet = process.env.STOCKPILOT_DEMO_TRADER_WALLET?.trim();
if (!wallet) throw new Error("Set STOCKPILOT_DEMO_TRADER_WALLET to the demo public address.");
const solana = createSolanaReadAdapter();
const jupiter = new JupiterV2Adapter(process.env.JUPITER_API_KEY?.trim() || null);
const balance = await solana.getNativeBalance(wallet);
console.log(JSON.stringify({ operation: "unsigned-atomic-roundtrip-simulation", nativeBalanceLamports: balance.rawLamports }));

function inspection(build: JupiterBuild): PreparedTransactionInspection {
  const instructions = [...build.computeBudgetInstructions, ...build.setupInstructions, build.swapInstruction]
    .map((instruction) => ({ programAddress: instruction.programId,
      accounts: instruction.accounts.map((item) => ({ address: item.pubkey,
        writable: item.isWritable || item.pubkey === wallet, signer: item.isSigner || item.pubkey === wallet })),
      data: Uint8Array.from(Buffer.from(instruction.data, "base64")) }));
  return { feePayer: wallet!, instructions, allAddresses: [], writableAddresses: [], lookupTableAddresses: [] };
}

for (const product of [
  { provider: "prestocks" as const, mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", dex: "Meteora DLMM" as const },
  { provider: "xstocks" as const, mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", dex: "Raydium CLMM" as const },
]) {
  try {
    const decimals = await solana.getTokenDecimals(product.mint);
    const buy = await jupiter.build({ inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: product.mint,
      amountRaw: "100000", taker: wallet, slippageBps: 100, directDex: product.dex });
    // Less than the conservative BUY floor, so the second instruction can use
    // only the tokens this simulation actually creates in the first swap.
    const sellAmountRaw = (BigInt(buy.outAmount) * 95n / 100n).toString();
    const sell = await jupiter.build({ inputMint: product.mint, outputMint: SOLANA_MAINNET_USDC_MINT,
      amountRaw: sellAmountRaw, taker: wallet, slippageBps: 100, directDex: product.dex });
    const common = { walletAddress: wallet, requestId: "read-only-roundtrip", lastValidBlockHeight: null,
      router: product.dex, mode: "manual", feeBps: 0, feeMint: null, priceImpactPct: "0", transaction: "" };
    const buyPrepared: PreparedInvestment = { ...common,
      asset: { symbol: product.provider, name: product.provider, mintAddress: product.mint },
      fundingAsset: { symbol: "USDC", mintAddress: SOLANA_MAINNET_USDC_MINT }, inputAmountRaw: "100000",
      inputAmountUsd: "0.1", outputAmountRaw: buy.outAmount, outputDecimals: decimals,
      expireAt: null, createdAt: new Date().toISOString() };
    const sellPrepared: PreparedManualSell = { ...common,
      assetId: `${product.provider}:${product.mint}`, provider: product.provider, principalId: "read-only-probe",
      inputMint: product.mint, outputMint: SOLANA_MAINNET_USDC_MINT, inputRaw: sellAmountRaw,
      inputDecimals: decimals, inputUnits: "RAW_TOKEN_BASE_UNITS", quotedUsdcOutRaw: sell.outAmount,
      requiredMinimumUsdcOutRaw: (BigInt(sell.outAmount) * 99n / 100n).toString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), transactionStatus: "REQUIRES_INSTRUCTION_VALIDATION" };
    parseSupportedJupiterRoute(inspection(buy), buyPrepared);
    parseSupportedJupiterRoute(inspection(sell), sellPrepared);
    const lookupTables = { ...buy.addressesByLookupTableAddress };
    for (const [key, entries] of Object.entries(sell.addressesByLookupTableAddress)) {
      const prior = lookupTables[key];
      if (prior && prior.some((entry, index) => entries[index] !== entry)) throw new Error("Lookup tables changed during probe.");
      lookupTables[key] = entries;
    }
    // One CU budget covers both swaps; ATA setup remains idempotent. No fake
    // balance is injected, so insufficient actual SOL is a real probe failure.
    const combined = { ...buy, addressesByLookupTableAddress: lookupTables,
      otherInstructions: [...sell.setupInstructions, sell.swapInstruction] };
    const transaction = assembleJupiterBuildTransaction(combined, wallet);
    const byteLength = Buffer.from(transaction, "base64").length;
    const observedAccounts = [wallet, buy.swapInstruction.accounts[1].pubkey, buy.swapInstruction.accounts[2].pubkey];
    const beforeResponse = await fetch(getSolanaRpcUrl(), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts",
        params: [observedAccounts, { encoding: "base64", commitment: "confirmed" }] }), signal: AbortSignal.timeout(15_000) });
    const before = (await beforeResponse.json()).result?.value;
    const response = await fetch(getSolanaRpcUrl(), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "simulateTransaction", params: [transaction,
        { encoding: "base64", commitment: "confirmed", sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true,
          accounts: { encoding: "base64", addresses: observedAccounts } }] }),
      signal: AbortSignal.timeout(20_000) });
    const result = await response.json();
    const value = result.result?.value;
    const tokenRaw = (entry: { data: [string, string] } | null | undefined) => entry
      ? Buffer.from(entry.data[0], "base64").readBigUInt64LE(64) : 0n;
    const effects = value?.err === null && before && value.accounts ? {
      actualWalletNativeDebitLamports: String(BigInt(before[0].lamports) - BigInt(value.accounts[0].lamports)),
      tokenAccountRentLamports: value.accounts[2]?.lamports ?? null,
      actualUsdcRoundtripDebitRaw: String(tokenRaw(before[1]) - tokenRaw(value.accounts[1])),
      actualTokenRemainderRaw: String(tokenRaw(value.accounts[2]) - tokenRaw(before[2])),
    } : null;
    console.log(JSON.stringify({ provider: product.provider, parsedBuyAndSellEconomics: true,
      transactionBytes: byteLength, messageHash: createHash("sha256").update(transaction).digest("hex"),
      grossSellInputRaw: sellAmountRaw, estimatedUsdcReturnRaw: sell.outAmount,
      simulationSucceeded: Boolean(value) && value.err === null,
      simulationError: value?.err ?? result.error ?? null, unitsConsumed: value?.unitsConsumed ?? null,
      effects,
      programLogs: value?.logs?.filter((line: string) => /Instruction: Swap|Instruction: Route|success|error|failed|insufficient|TransferChecked/i.test(line)) }));
  } catch (error) {
    console.log(JSON.stringify({ provider: product.provider, simulationSucceeded: false,
      error: error instanceof Error ? error.message : "Probe failed" }));
  }
}
