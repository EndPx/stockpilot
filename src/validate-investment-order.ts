import { SOLANA_MAINNET_USDC_DECIMALS, SOLANA_MAINNET_USDC_MINT } from "./constants.js";
import { fetchPreStocks } from "@stockpilot/integrations/prestocks";

const JUPITER_ORDER_URL = "https://api.jup.ag/swap/v2/order";

function readOrder(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Jupiter returned an invalid order response.");
  }
  return value as Record<string, unknown>;
}

try {
  console.log("StockPilot safe investment-order validation\n");
  console.log("Safety: this script sends no transaction to a wallet or Jupiter execute endpoint.\n");

  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) {
    console.log("RESULT\nBLOCKED\n\nJUPITER_API_KEY is not configured. No request, signing, or execution occurred.");
    process.exitCode = 0;
  } else {
    const assets = await fetchPreStocks();
    const asset = assets.find((item) => item.symbol === "SPACEX");
    if (!asset) throw new Error("PreStocks did not provide its official SPACEX asset.");

    const url = new URL(JUPITER_ORDER_URL);
    url.searchParams.set("inputMint", SOLANA_MAINNET_USDC_MINT);
    url.searchParams.set("outputMint", asset.mintAddress);
    url.searchParams.set("amount", String(10 ** SOLANA_MAINNET_USDC_DECIMALS));
    // Intentionally omit `taker`: Jupiter cannot return an executable transaction.
    const response = await fetch(url, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const order = readOrder(await response.json());
    if (!response.ok) throw new Error("Jupiter could not prepare a safe validation order.");
    if (order.inputMint !== SOLANA_MAINNET_USDC_MINT || order.outputMint !== asset.mintAddress) {
      throw new Error("Jupiter order does not match the canonical USDC and official PreStocks mints.");
    }

    console.log("Official asset");
    console.log(`${asset.symbol} — ${asset.mintAddress}\n`);
    console.log("Safe order");
    console.log(`Input: 1 USDC (${SOLANA_MAINNET_USDC_MINT})`);
    console.log(`Estimated output: ${typeof order.outAmount === "string" ? order.outAmount : "unavailable"} raw ${asset.symbol}`);
    console.log(`Router: ${typeof order.router === "string" ? order.router : "unavailable"}`);
    console.log(`Transaction returned: ${typeof order.transaction === "string" && order.transaction.length > 0 ? "unexpected — not used" : "no (expected without taker)"}`);
    console.log("\nRESULT\nPASS\n\nOrder-only validation completed. No signing or execution occurred.");
  }
} catch (error) {
  console.error("\nRESULT\nBLOCKED\n");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
