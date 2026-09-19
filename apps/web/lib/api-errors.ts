import { InvalidAssetInput } from "./asset-inputs";

export function assetApiError(error: unknown): Response {
  if (error instanceof InvalidAssetInput) {
    return Response.json({ error: { code: "INVALID_INPUT", message: error.message } }, { status: 400 });
  }
  // Avoid logging provider URLs, credentials, or raw remote payloads.
  console.error("[assets] Provider request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "We couldn't load the market right now. Please try again." } }, { status: 503 });
}
