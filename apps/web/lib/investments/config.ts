import "server-only";
import { isAuthEnabled } from "@/lib/auth/config";
import { isPrivyMode } from "@/lib/privy/config";
import { InvestmentApiError } from "./errors";

/** Operator-controlled kill switch, never a client parameter or agent credential. */
export function investmentsEnabled(): boolean {
  // Legacy wallet-signature execution cannot sign with a Privy embedded wallet.
  return !isPrivyMode() && process.env.INVESTMENTS_ENABLED === "true" && isAuthEnabled();
}

export function assertInvestmentsEnabled(): void {
  if (!investmentsEnabled()) throw new InvestmentApiError("INVESTMENTS_DISABLED", 503);
}
