import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { createClient, listClients, type ClientScope, type ClientType } from "@/lib/control-plane/clients";
import { controlApiError, exactObject, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireControlOwner(request);
    return jsonResponse({ clients: await listClients(identity) });
  } catch (error) { return controlApiError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const identity = await requireControlOwner(request, true);
    const body = exactObject(await readJsonBody(request, 2_048),
      ["name", "clientType", "scopes", "maxInvestmentUsd", "dailyRequestLimitUsd"]);
    const client = await createClient({
      identity, name: body.name as string, clientType: body.clientType as ClientType,
      scopes: body.scopes as ClientScope[], maxInvestmentUsd: body.maxInvestmentUsd as string,
      dailyRequestLimitUsd: body.dailyRequestLimitUsd as string,
    });
    return jsonResponse({ client }, { status: 201 });
  } catch (error) { return controlApiError(error); }
}
