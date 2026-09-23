import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { decideRequest, getOwnerRequest } from "@/lib/control-plane/approvals";
import { controlApiError, exactObject, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/control/approvals/[id]">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    const { id } = await context.params;
    return jsonResponse({ approval: await getOwnerRequest(identity, id) });
  } catch (error) { return controlApiError(error); }
}

export async function POST(request: Request, context: RouteContext<"/api/control/approvals/[id]">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request, true);
    const { id } = await context.params;
    const body = exactObject(await readJsonBody(request, 256), ["decision"]);
    if (body.decision !== "APPROVED" && body.decision !== "REJECTED") {
      return jsonResponse({ error: { code: "INVALID_DECISION", message: "Choose Approve or Reject." } }, { status: 400 });
    }
    return jsonResponse({ approval: await decideRequest(identity, id, body.decision), executionAvailable: false });
  } catch (error) { return controlApiError(error); }
}
