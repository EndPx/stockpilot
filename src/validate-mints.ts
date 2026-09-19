import { fetchPreStocks } from "./prestocks.js";
import { validateSolanaMint } from "./solana.js";

const assets = await fetchPreStocks();
const results = await Promise.all(
  assets.map(async (asset) => ({
    symbol: asset.symbol,
    ...(await validateSolanaMint(asset.mintAddress)),
  })),
);

console.table(results);

if (results.some((result) => !result.isTokenMint)) {
  process.exitCode = 1;
}
