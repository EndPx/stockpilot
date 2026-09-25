import { jsonResponse } from "@/lib/auth/http";
import { getActivityWeek, listActivity } from "@/lib/control-plane/activity";
import { ControlPlaneError } from "@/lib/control-plane/clients";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    const clientIds = new URL(request.url).searchParams.getAll("clientId");
    if (clientIds.length > 1) throw new ControlPlaneError("INVALID_CLIENT", "Specify one client ID.");
    const activity = await listActivity(identity, 50, undefined, clientIds[0]);
    if (clientIds[0] !== undefined) return jsonResponse({ activity });
    return jsonResponse({ activity, week: await getActivityWeek(identity) });
  } catch (error) { return controlApiError(error); }
}
