import { getAsset } from "@/lib/assets";
import { parseAssetSymbol } from "@/lib/asset-inputs";
import { assetApiError } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  try {
    const symbol = parseAssetSymbol((await context.params).symbol);
    const { asset, meta } = await getAsset(symbol);
    if (!asset) {
      return Response.json({ error: { code: "ASSET_NOT_FOUND", message: "The requested PreStocks asset was not found." } }, { status: 404 });
    }
    return Response.json({ asset, meta }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return assetApiError(error);
  }
}
