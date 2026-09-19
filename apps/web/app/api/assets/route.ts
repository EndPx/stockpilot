import { listAssets } from "@/lib/assets";
import { parseAssetQuery } from "@/lib/asset-inputs";
import { assetApiError } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const values = new URL(request.url).searchParams.getAll("q");
    const query = parseAssetQuery(values.length > 1 ? values : values[0]);
    const { assets, meta } = await listAssets(query);
    return Response.json({ assets, meta }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return assetApiError(error);
  }
}
