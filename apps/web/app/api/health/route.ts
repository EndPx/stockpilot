import { isAuthEnabled } from "@/lib/auth/config";
import { investmentsEnabled } from "@/lib/investments/config";

export const dynamic = "force-dynamic";

// Liveness/capabilities only. Never expose environment values, RPC URLs or secrets.
export function GET() {
  return Response.json({ status: "ok", authEnabled: isAuthEnabled(), investmentsEnabled: investmentsEnabled(), agentExecutionEnabled: false }, { headers: { "Cache-Control": "no-store" } });
}
