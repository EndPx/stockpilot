import { SOLANA_MAINNET_USDC_DECIMALS, SOLANA_MAINNET_USDC_MINT } from "./constants.js";
import { getJupiterQuote } from "./jupiter.js";
import { fetchPreStocks } from "@stockpilot/integrations/prestocks";
import { getSolanaTokenDecimals, validateSolanaMint } from "./solana.js";

function formatRawAmount(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

try {
  console.log("StockPilot execution validation\n");

  const assets = await fetchPreStocks();
  console.log("PreStocks API");
  console.log(`✓ ${assets.length} assets loaded\n`);

  const asset = assets.find((item) => item.symbol === "SPACEX") ?? assets[0];
  if (!asset) throw new Error("PreStocks API returned no assets.");

  console.log("Selected asset");
  console.log(asset.name);
  console.log(asset.symbol);
  console.log(`Mint: ${asset.mintAddress}\n`);

  const mintValidation = await validateSolanaMint(asset.mintAddress);
  console.log("Solana mint validation");
  if (!mintValidation.isTokenMint) throw new Error("Selected PreStocks address is not a mainnet token mint.");
  console.log("✓ valid mainnet token mint\n");

  console.log("Input asset");
  console.log("USDC");
  console.log(`Mint: ${SOLANA_MAINNET_USDC_MINT}\n`);

  const quote = await getJupiterQuote({
    inputMint: SOLANA_MAINNET_USDC_MINT,
    outputMint: asset.mintAddress,
    amount: 10n ** BigInt(SOLANA_MAINNET_USDC_DECIMALS),
    slippageBps: 50,
  });
  const outputDecimals = await getSolanaTokenDecimals(asset.mintAddress);

  console.log("Jupiter route");
  console.log("✓ route found\n");
  console.log("Input");
  console.log("1 USDC\n");
  console.log("Estimated output");
  console.log(`${formatRawAmount(quote.outputAmountRaw, outputDecimals)} ${asset.symbol}\n`);
  console.log("Price impact");
  console.log(`${quote.priceImpactPct}%\n`);
  console.log("Route");
  console.log(quote.routeLabels.join(" → ") || "Provider route label unavailable");
  console.log("\nRESULT\nPASS\n\nUSDC → PreStocks execution path is available through Jupiter.");
} catch (error) {
  console.error("\nRESULT\nBLOCKED\n");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
