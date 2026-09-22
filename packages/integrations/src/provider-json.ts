export const MAX_PROVIDER_JSON_BYTES = 2 * 1024 * 1024;

/** Bounds decoded response bytes, including chunked and compressed responses. */
export async function readProviderJson(
  response: Response,
  maxBytes = MAX_PROVIDER_JSON_BYTES,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid provider response limit.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Provider response exceeds the byte limit.");
  }
  if (!response.body) throw new Error("Provider response has no JSON body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        throw new Error("Provider response exceeds the byte limit.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join("")) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
