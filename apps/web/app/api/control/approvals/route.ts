import { jsonResponse } from "@/lib/auth/http";
import { listOwnerRequests } from "@/lib/control-plane/approvals";
import type { RequestStatus } from "@/lib/control-plane/requests";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "ALL";
    if ([...url.searchParams.keys()].some((key) => key !== "status") || url.searchParams.getAll("status").length > 1) {
      return jsonResponse({ error: { code: "INVALID_FILTER", message: "Invalid approval filter." } }, { status: 400 });
    }
    return jsonResponse({ approvals: await listOwnerRequests(identity, status as RequestStatus | "ALL") });
  } catch (error) { return controlApiError(error); }
}
