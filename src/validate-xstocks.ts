/** Read-only research probe. Not imported by the app, not a production provider. */
import { isAddress } from "@solana/kit";
import { SOLANA_MAINNET_RPC_URL, SOLANA_MAINNET_USDC_MINT, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import { getJupiterQuote } from "./jupiter.js";

const source = "https://api.xstocks.fi/api/v2/public/assets";
type Row = { id: string; symbol: string; underlying: { type: string | null } | null; deployments: { network: string; address: string }[] };
const rows: Row[] = [];
let complete = false;
for (let page = 0; page < 30; page++) {
  const response = await fetch(`${source}?network=Solana&pageSize=100&page=${page}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Issuer catalog HTTP ${response.status}`);
  const result = await response.json() as { nodes: Row[]; page: { currentPage: number; hasNextPage: boolean } };
  if (!Array.isArray(result.nodes) || result.page?.currentPage !== page || typeof result.page.hasNextPage !== "boolean") throw new Error("Unexpected issuer pagination.");
  rows.push(...result.nodes);
  if (!result.page.hasNextPage) { complete = true; break; }
}
if (!complete) throw new Error("Incomplete issuer pagination.");
const candidates = rows.map((row) => {
  const deployments = row.deployments.filter(({ network }) => network === "Solana");
  if (deployments.length !== 1 || !isAddress(deployments[0].address)) throw new Error("Ambiguous or invalid Solana deployment.");
  return { symbol: row.symbol, issuerId: row.id, mint: deployments[0].address, type: row.underlying?.type ?? null };
});
if (new Set(candidates.map(({ mint }) => mint)).size !== candidates.length || new Set(candidates.map(({ issuerId }) => issuerId)).size !== candidates.length) throw new Error("Duplicate issuer assets/mints.");
console.log(JSON.stringify({ source, checkedAt: new Date().toISOString(), canonicalSolanaCandidates: candidates.length, explicitlyClassifiedEquitiesOrEtfs: candidates.filter(({ type }) => type === "Equity" || type === "ETF").length, unclassified: candidates.filter(({ type }) => !type).length }));

// Sample chosen by ticker only AFTER canonical issuer discovery; never ticker-based trust.
const sample = candidates.find(({ symbol }) => symbol === "AAPLx");
if (!sample) throw new Error("Issuer sample unavailable.");
const rpc = await fetch(process.env.SOLANA_RPC_URL ?? SOLANA_MAINNET_RPC_URL, {
  method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000),
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [sample.mint, { encoding: "jsonParsed", commitment: "confirmed" }] }),
});
if (!rpc.ok) throw new Error(`Mint read HTTP ${rpc.status}`);
const account = (await rpc.json() as { result?: { value?: { owner: string; data: { parsed?: { type: string; info: { decimals: number; isInitialized: boolean; extensions?: { extension: string; state?: unknown }[] } } } } } }).result?.value;
if (account?.owner !== TOKEN_2022_PROGRAM_ADDRESS || account.data.parsed?.type !== "mint" || !account.data.parsed.info.isInitialized) throw new Error("Sample did not verify as an initialized Token-2022 mint.");
console.log(JSON.stringify({ sample: sample.symbol, mint: sample.mint, program: account.owner, decimals: account.data.parsed.info.decimals, extensions: account.data.parsed.info.extensions?.map(({ extension }) => extension) }));
try {
  const quote = await getJupiterQuote({ inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: sample.mint, amount: 1_000_000n, slippageBps: 50 });
  if (quote.inputMint !== SOLANA_MAINNET_USDC_MINT || quote.outputMint !== sample.mint || quote.inputAmountRaw !== "1000000" || BigInt(quote.outputAmountRaw) <= 0n || quote.routeLabels.length === 0) throw new Error("Mismatched or empty quote.");
  console.log(JSON.stringify({ quoteOnly: true, sample: sample.symbol, inputRaw: quote.inputAmountRaw, outputRaw: quote.outputAmountRaw, routes: quote.routeLabels }));
} catch {
  console.log("JUPITER SAMPLE QUOTE: BLOCKED (no valid live quote established; no transaction prepared or executed)");
}
console.log("Research probe complete. Canonical candidates are NOT a production allowlist or legal eligibility approval.");
