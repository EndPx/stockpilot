import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { type ClientScope } from "@/lib/control-plane/clients";
import { getPolicy, updatePolicy } from "@/lib/control-plane/policies";
import { controlApiError, exactObject, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/control/clients/[id]/policy">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    const { id } = await context.params;
    return jsonResponse({ policy: await getPolicy(identity, id) });
  } catch (error) { return controlApiError(error); }
}

export async function PATCH(request: Request, context: RouteContext<"/api/control/clients/[id]/policy">): Promise<Response> {
  try {
    const identity = await requireControlOwner(request, true);
    const { id } = await context.params;
    const body = exactObject(await readJsonBody(request, 2_048),
      ["scopes", "buyMode", "sellMode", "maxInvestmentUsd", "dailyRequestLimitUsd", "expectedVersion"]);
    const policy = await updatePolicy(identity, id, {
      scopes: body.scopes as ClientScope[], maxInvestmentUsd: body.maxInvestmentUsd as string | null,
      dailyRequestLimitUsd: body.dailyRequestLimitUsd as string | null,
      buyMode: body.buyMode as "DISABLED" | "APPROVAL" | "AUTO" | undefined,
      sellMode: body.sellMode as "DISABLED" | "APPROVAL" | "AUTO" | undefined,
      expectedVersion: body.expectedVersion as number,
    });
    return jsonResponse({ policy });
  } catch (error) { return controlApiError(error); }
}
