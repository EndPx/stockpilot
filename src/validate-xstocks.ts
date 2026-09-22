/** Read-only sequential probe. No wallet, order, transaction or execution API. */
import { fetchXStocks } from "@stockpilot/integrations/xstocks";
import { InvestmentAssetRegistry } from "@stockpilot/core/asset-registry";
import { ExecutionEligibilityService } from "@stockpilot/core/execution-eligibility";

const assets = await fetchXStocks();
const fetchedAt = new Date().toISOString();
const registry = new InvestmentAssetRegistry([{ provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT", getSnapshot: async () => ({ assets, fetchedAt, stale: false }) }]);
const validator = new ExecutionEligibilityService(registry);
console.log(JSON.stringify({ fetchedAt, canonicalSolanaProducts: assets.length, classification: assets.reduce<Record<string, number>>((counts, asset) => { counts[asset.marketType] = (counts[asset.marketType] ?? 0) + 1; return counts; }, {}) }));
for (const symbol of ["AAPLx", "NVDAx", "TSLAx"]) {
  const matches = assets.filter((asset) => asset.symbol === symbol);
  if (matches.length !== 1) throw new Error(`Canonical representative ${symbol} missing or ambiguous.`);
  const asset = matches[0];
  const validation = await validator.validateForExecution(asset.id);
  console.log(JSON.stringify({ symbol, metadata: asset.metadata, validation }));
}
console.log("READ-ONLY COMPLETE: catalog, mint reads and diagnostic quotes only. No production execution approval.");
