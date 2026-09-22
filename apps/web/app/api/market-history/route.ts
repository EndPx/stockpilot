import {
  getMarketHistory,
  MarketHistoryRequestError,
  parseMarketHistoryQuery,
} from "@/lib/market-history";

export const dynamic = "force-dynamic";

export function createMarketHistoryGet(read = getMarketHistory) {
  return async function GET(request: Request): Promise<Response> {
    const headers = new Headers({ "Cache-Control": "no-store" });
    try {
      const query = parseMarketHistoryQuery(new URL(request.url).searchParams);
      return Response.json(await read(query), { headers });
    } catch (error) {
      const failure = error instanceof MarketHistoryRequestError ? error : new MarketHistoryRequestError(503);
      if (failure.status === 503) headers.set("Retry-After", "60");
      return Response.json({ error: { code: failure.code, message: failure.message } }, {
        status: failure.status, headers,
      });
    }
  };
}

export const GET = createMarketHistoryGet();
