/** Read-only production-route probe. Never signs or submits a transaction. */
import { prepareDemoTrade } from "../lib/investments/demo-trade";
import { getSolanaRpcUrl } from "../lib/solana/read-adapter";

const wallet = process.env.STOCKPILOT_DEMO_TRADER_WALLET?.trim();
if (!wallet) throw new Error("Set STOCKPILOT_DEMO_TRADER_WALLET to the demo public address.");

for (const product of [
  { provider: "prestocks" as const, mintAddress: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP" },
  { provider: "xstocks" as const, mintAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
]) {
  const { review, prepared } = await prepareDemoTrade(wallet, "read-only-probe", {
    side: "BUY", ...product, amount: "0.1", eligibleNonUsAttestation: true,
  });
  console.log(JSON.stringify({ provider: product.provider, verified: true,
    spendUsdc: review.inputAmount, estimatedOutput: review.estimatedOutputAmount,
    maxSolDebitLamports: review.maximumWalletNativeDebitLamportsRaw }));
  if (process.argv.includes("--simulate")) {
    const response = await fetch(getSolanaRpcUrl(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "simulateTransaction",
        params: [prepared.transaction, { encoding: "base64", commitment: "confirmed",
          sigVerify: false, replaceRecentBlockhash: true }] }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    console.log(JSON.stringify({ provider: product.provider, simulationError: result.result?.value?.err ?? result.error ?? null,
      unitsConsumed: result.result?.value?.unitsConsumed ?? null,
      programErrors: result.result?.value?.logs?.filter((line: string) => /error|failed|insufficient/i.test(line)) }));
  }
}
