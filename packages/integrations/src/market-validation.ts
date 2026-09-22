import { isAddress } from "@solana/kit";

export type MintInspection = {
  mint: string; program: string; decimals: number; supplyRaw: string;
  mintAuthority: string | null; freezeAuthority: string | null;
  extensions: { name: string; state: Record<string, unknown> }[];
};
export type ReadOnlyQuote = { inputMint: string; outputMint: string; inputRaw: string; outputRaw: string; venues: string[] };
const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed read-only response.");
  return value as Record<string, unknown>;
}
function authority(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isAddress(value)) throw new Error("Invalid authority.");
  return value;
}
export function normalizeMintInspection(mint: string, accountValue: unknown): MintInspection {
  if (!isAddress(mint)) throw new Error("Invalid mint.");
  const account = object(accountValue);
  const parsed = object(object(account.data).parsed);
  const info = object(parsed.info);
  if (!programs.includes(String(account.owner)) || parsed.type !== "mint" || info.isInitialized !== true ||
      typeof info.decimals !== "number" || !Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 255 ||
      typeof info.supply !== "string" || !/^(0|[1-9]\d{0,19})$/.test(info.supply) || BigInt(info.supply) > 18446744073709551615n) throw new Error("Invalid initialized token mint.");
  if (info.extensions !== undefined && !Array.isArray(info.extensions)) throw new Error("Malformed extensions.");
  const extensions = ((info.extensions ?? []) as unknown[]).map((value) => {
    const extension = object(value);
    if (typeof extension.extension !== "string") throw new Error("Missing extension name.");
    return { name: extension.extension, state: object(extension.state) };
  });
  if (new Set(extensions.map(({ name }) => name)).size !== extensions.length || (account.owner === programs[0] && extensions.length)) throw new Error("Ambiguous mint extensions.");
  return { mint, program: String(account.owner), decimals: info.decimals, supplyRaw: info.supply, mintAuthority: authority(info.mintAuthority), freezeAuthority: authority(info.freezeAuthority), extensions };
}

/** RPC read only: no simulation or transaction construction. */
export async function inspectMarketMint(mint: string, fetcher: typeof fetch = fetch): Promise<MintInspection> {
  if (!isAddress(mint)) throw new Error("Invalid mint.");
  const response = await fetcher(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed", commitment: "confirmed" }] }),
  });
  if (!response.ok) throw new Error("Mint read unavailable.");
  const payload = object(await response.json());
  if (payload.error) throw new Error("Mint read unavailable.");
  return normalizeMintInspection(mint, object(payload.result).value);
}

export class MarketQuoteError extends Error {
  constructor(readonly reason: "NO_JUPITER_ROUTE" | "QUOTE_UNAVAILABLE") { super(reason); }
}
/** Fixed 1 USDC diagnostic GET. This module cannot return a transaction. */
export async function quoteMarketMint(mint: string, fetcher: typeof fetch = fetch): Promise<ReadOnlyQuote> {
  if (!isAddress(mint)) throw new Error("Invalid mint.");
  const url = new URL("https://api.jup.ag/swap/v1/quote");
  url.search = new URLSearchParams({ inputMint: usdc, outputMint: mint, amount: "1000000", slippageBps: "50", swapMode: "ExactIn" }).toString();
  const key = process.env.JUPITER_API_KEY;
  const response = await fetcher(url, { headers: key ? { "x-api-key": key } : {}, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  const data = object(await response.json());
  if (!response.ok) throw new MarketQuoteError(data.errorCode === "COULD_NOT_FIND_ANY_ROUTE" || data.errorCode === "TOKEN_NOT_TRADABLE" ? "NO_JUPITER_ROUTE" : "QUOTE_UNAVAILABLE");
  if (data.inputMint !== usdc || data.outputMint !== mint || data.inAmount !== "1000000" || data.swapMode !== "ExactIn" ||
      typeof data.outAmount !== "string" || !/^[1-9]\d{0,19}$/.test(data.outAmount) || BigInt(data.outAmount) > 18446744073709551615n ||
      !Array.isArray(data.routePlan) || !data.routePlan.length) throw new Error("Invalid quote identity or amount.");
  const venues = data.routePlan.map((item) => object(object(item).swapInfo).label);
  if (venues.some((label) => typeof label !== "string" || !label)) throw new Error("Invalid route.");
  return { inputMint: usdc, outputMint: mint, inputRaw: "1000000", outputRaw: data.outAmount, venues: venues as string[] };
}
