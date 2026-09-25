import { jsonResponse } from "@/lib/auth/http";
import { getClient, revokeClient } from "@/lib/control-plane/clients";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/control/clients/[id]">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    const { id } = await context.params;
    return jsonResponse({ client: await getClient(identity, id) });
  } catch (error) { return controlApiError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/control/clients/[id]">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request, true);
    const { id } = await context.params;
    await revokeClient(identity, id);
    return jsonResponse({ revoked: true });
  } catch (error) { return controlApiError(error); }
}
