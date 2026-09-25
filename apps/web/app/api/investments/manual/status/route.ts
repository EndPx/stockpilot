import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { requireControlOwner } from "@/lib/control-plane/web-api";
import { InvestmentApiError, investmentErrorResponse } from "@/lib/investments/errors";
import { readManualBuyStatus, readRecoverableManualTradeStatus } from "@/lib/investments/manual-status";

export const dynamic = "force-dynamic";

type Dependencies = {
  readStatus: typeof readManualBuyStatus;
  recover: typeof readRecoverableManualTradeStatus;
};

/** POST because verified chain finality may advance the durable execution ledger. */
export function createManualStatusPost(dependencies: Partial<Dependencies> = {}) {
  const deps = { readStatus: readManualBuyStatus, recover: readRecoverableManualTradeStatus, ...dependencies };
  return async function POST(request: Request): Promise<Response> {
    try {
      const owner = await requireControlOwner(request, true);
      const body = await readJsonBody(request, 512);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) {
        throw new InvestmentApiError("INVALID_REQUEST", 400);
      }
      if (Object.hasOwn(body, "active") && (body as { active?: unknown }).active === true) {
        return jsonResponse({ execution: await deps.recover(owner) });
      }
      if (!Object.hasOwn(body, "providerRequestId") ||
        typeof (body as { providerRequestId?: unknown }).providerRequestId !== "string" ||
        (body as { providerRequestId: string }).providerRequestId.length < 1 ||
        (body as { providerRequestId: string }).providerRequestId.length > 256) {
        throw new InvestmentApiError("INVALID_REQUEST", 400);
      }
      const result = await deps.readStatus(owner, (body as { providerRequestId: string }).providerRequestId);
      if (!result) return jsonResponse({ error: { code: "INVESTMENT_NOT_FOUND", message: "This trade was not found." } }, { status: 404 });
      return jsonResponse({ execution: result });
    } catch (error) {
      return investmentErrorResponse(error);
    }
  };
}

export const POST = createManualStatusPost();
