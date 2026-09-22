import { listMarkets } from "@/lib/markets";
import { parseMarketInputs } from "@/lib/market-inputs";
import { RegistryQueryError } from "@stockpilot/core/asset-registry";
export const dynamic = "force-dynamic";
export function createMarketsGet(read = listMarkets) {
  return async function GET(request: Request) {
    try {
      const params = new URL(request.url).searchParams;
      const inputs = Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key).length === 1 ? params.get(key)! : params.getAll(key)]));
      return Response.json(await read(parseMarketInputs(inputs)), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const invalid = error instanceof RegistryQueryError;
      return Response.json({ error: { code: invalid ? "INVALID_MARKET_QUERY" : "MARKET_CATALOG_UNAVAILABLE", message: invalid ? error.message : "The official market catalog is temporarily unavailable." } }, { status: invalid ? 400 : 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
export const GET = createMarketsGet();
