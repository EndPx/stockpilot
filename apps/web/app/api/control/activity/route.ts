import { jsonResponse } from "@/lib/auth/http";
import { listActivity } from "@/lib/control-plane/activity";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    return jsonResponse({ activity: await listActivity(identity) });
  } catch (error) { return controlApiError(error); }
}
