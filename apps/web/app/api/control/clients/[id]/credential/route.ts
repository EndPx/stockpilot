import { jsonResponse } from "@/lib/auth/http";
import { issueCredential, revokeCredential, rotateCredential } from "@/lib/control-plane/credentials";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/control/clients/[id]/credential">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request, true);
    const { id } = await context.params;
    return jsonResponse({ credential: await issueCredential(identity, id) }, { status: 201 });
  } catch (error) { return controlApiError(error); }
}

export async function PUT(request: Request, context: RouteContext<"/api/control/clients/[id]/credential">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request, true);
    const { id } = await context.params;
    return jsonResponse({ credential: await rotateCredential(identity, id) });
  } catch (error) { return controlApiError(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/control/clients/[id]/credential">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request, true);
    const { id } = await context.params;
    await revokeCredential(identity, id);
    return jsonResponse({ revoked: true });
  } catch (error) { return controlApiError(error); }
}
