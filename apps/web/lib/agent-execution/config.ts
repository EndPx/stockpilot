import "server-only";
import { isAuthEnabled } from "@/lib/auth/config";
import { isPrivyMode } from "@/lib/privy/config";

/** Operator readiness only; every call also needs an owner policy and a live wallet delegation. */
export function agentExecutionEnabled(): boolean {
  return isPrivyMode() && isAuthEnabled() && process.env.AGENT_EXECUTION_ENABLED === "true" &&
    ["PRIVY_APP_SECRET", "PRIVY_EXECUTION_SIGNER_ID", "PRIVY_EXECUTION_POLICY_ID",
      "PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY"].every((key) => Boolean(process.env[key]?.trim())) &&
    Date.parse(process.env.PRIVY_EXECUTION_EXPIRES_AT ?? "") > Date.now();
}
