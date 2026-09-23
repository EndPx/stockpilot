import { jsonResponse } from "@/lib/auth/http";
import { listCredentials } from "@/lib/control-plane/credentials";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    return jsonResponse({ credentials: await listCredentials(identity) });
  } catch (error) { return controlApiError(error); }
}
