import { jsonResponse, readJsonBody } from "@/lib/auth/http";
import { AgentOperationError, getAgentWalletPolicy, updateAgentWalletPolicy,
  type AgentWalletPolicyInput } from "@/lib/control-plane/agent-operations";
import { controlApiError, requireControlOwner } from "@/lib/control-plane/web-api";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
type Dependencies = {
  owner: typeof requireControlOwner; get: typeof getAgentWalletPolicy; update: typeof updateAgentWalletPolicy;
};
const defaults: Dependencies = { owner: requireControlOwner, get: getAgentWalletPolicy, update: updateAgentWalletPolicy };

function errorResponse(error: unknown): Response {
  if (!(error instanceof AgentOperationError)) return controlApiError(error);
  const status = error.code === "CLIENT_NOT_ALLOWED" ? 403 : error.code === "POLICY_VERSION_MISMATCH" ? 409 : 400;
  const message = error.code === "POLICY_VERSION_MISMATCH"
    ? "This policy changed in another session. Reload it before saving again."
    : error.code === "CLIENT_NOT_ALLOWED" ? "This agent is unavailable or cannot be changed by this account."
      : error.code === "POLICY_EXPIRED" ? "Choose a future policy expiry."
        : "Check the execution permissions, amounts, recipients, and eligibility statements.";
  return jsonResponse({ error: { code: error.code, message } }, { status });
}

export function createExecutionPolicyHandlers(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  return {
    async GET(request: Request, context: Context): Promise<Response> {
      try {
        const identity = await deps.owner(request);
        const { id } = await context.params;
        return jsonResponse({ policy: await deps.get(identity, id) });
      } catch (error) { return errorResponse(error); }
    },
    async PATCH(request: Request, context: Context): Promise<Response> {
      try {
        const identity = await deps.owner(request, true);
        const { id } = await context.params;
        const body: unknown = await readJsonBody(request, 16_384);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new AgentOperationError("INVALID_INPUT");
        // The store validates every field, including explicit consent and optimistic version.
        const policy = await deps.update(identity, id, body as AgentWalletPolicyInput & { expectedVersion: number });
        return jsonResponse({ policy });
      } catch (error) { return errorResponse(error); }
    },
  };
}

export const { GET, PATCH } = createExecutionPolicyHandlers();
