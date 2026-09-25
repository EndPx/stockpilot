import "server-only";
import { isAuthEnabled } from "@/lib/auth/config";
import { isPrivyMode } from "@/lib/privy/config";
import { InvestmentApiError } from "./errors";

/** Operator-controlled kill switch, never a client parameter or agent credential. */
export function investmentsEnabled(): boolean {
  // The legacy wallet-signature route has been removed; manual execution now
  // requires a verified Privy owner session and the same wallet's signature.
  return isPrivyMode() && process.env.INVESTMENTS_ENABLED === "true" && isAuthEnabled();
}

export function assertInvestmentsEnabled(): void {
  if (!investmentsEnabled()) throw new InvestmentApiError("INVESTMENTS_DISABLED", 503);
}
