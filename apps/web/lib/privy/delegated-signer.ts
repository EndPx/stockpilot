import "server-only";

import { PrivyClient } from "@privy-io/node";
import { fingerprintTransactionMessage, assertSignedInvestmentTransaction } from "@/lib/investments/authorization";
import { PRIVY_APP_ID } from "./config";
import { selectPrimaryEmbeddedSolanaWallet } from "./server";

export type DelegatedIdentity = { privyUserId: string; walletAddress: string };
export type DelegatedSignerReason = "READY" | "NOT_CONFIGURED" | "EXECUTION_DISABLED" |
  "WALLET_MISMATCH" | "OWNER_CONSENT_REQUIRED" | "SIGNER_POLICY_MISMATCH" | "SIGNER_EXPIRED" | "PRIVY_UNAVAILABLE";
export type DelegatedSignerReadiness = {
  configured: boolean;
  enabled: boolean;
  ready: boolean;
  signerId: string | null;
  policyId: string | null;
  reason: DelegatedSignerReason;
};
export class DelegatedSignerError extends Error {
  constructor(readonly code: DelegatedSignerReason | "INVALID_SIGNING_REQUEST" | "SIGNING_UNAVAILABLE") {
    super(code);
    this.name = "DelegatedSignerError";
  }
}

type SignInput = { transaction: string; idempotencyKey: string; expiresAtMs: number };
type Client = {
  users(): { _get(userId: string): Promise<{ id: string; linked_accounts: unknown }> };
  wallets(): {
    get(walletId: string): Promise<{ id: string; address: string; chain_type: string;
      archived_at?: number | null; additional_signers: unknown }>;
    solana(): { signTransaction(walletId: string, input: {
      transaction: string; idempotency_key: string; request_expiry: number;
      authorization_context: { authorization_private_keys: string[] };
    }): Promise<{ encoding: string; signed_transaction: string }> };
  };
};
type Environment = Partial<Pick<NodeJS.ProcessEnv, "AGENT_EXECUTION_ENABLED" | "PRIVY_APP_SECRET" |
  "PRIVY_EXECUTION_SIGNER_ID" | "PRIVY_EXECUTION_POLICY_ID" | "PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY" |
  "PRIVY_EXECUTION_EXPIRES_AT">>;
type ClientOptions = { appId: string; appSecret: string; maxRetries: 0; timeout: number;
  requestExpiry: { defaultMs: number } };
type Dependencies = { environment: () => Environment; now: () => number;
  createClient: (options: ClientOptions) => Client };
const defaults: Dependencies = { environment: () => ({
  AGENT_EXECUTION_ENABLED: process.env.AGENT_EXECUTION_ENABLED,
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
  PRIVY_EXECUTION_SIGNER_ID: process.env.PRIVY_EXECUTION_SIGNER_ID,
  PRIVY_EXECUTION_POLICY_ID: process.env.PRIVY_EXECUTION_POLICY_ID,
  PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY: process.env.PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY,
  PRIVY_EXECUTION_EXPIRES_AT: process.env.PRIVY_EXECUTION_EXPIRES_AT,
}), now: Date.now,
  createClient: (options) => new PrivyClient(options) };
const MAX_SIGNING_LIFETIME_MS = 120_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** No wallet ownership is changed. Every call re-reads the owner's current delegation. */
export function createDelegatedSigner(dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  function config() {
    const env = deps.environment();
    const signerId = env.PRIVY_EXECUTION_SIGNER_ID?.trim() || null;
    const policyId = env.PRIVY_EXECUTION_POLICY_ID?.trim() || null;
    const appSecret = env.PRIVY_APP_SECRET?.trim() || "";
    const privateKey = env.PRIVY_EXECUTION_AUTHORIZATION_PRIVATE_KEY?.trim() || "";
    const expiresAtMs = Date.parse(env.PRIVY_EXECUTION_EXPIRES_AT?.trim() || "");
    return { signerId, policyId, appSecret, privateKey, expiresAtMs,
      configured: Boolean(signerId && policyId && appSecret && privateKey && Number.isFinite(expiresAtMs)),
      enabled: env.AGENT_EXECUTION_ENABLED === "true" };
  }

  async function inspect(identity: DelegatedIdentity) {
    const cfg = config();
    const status = (reason: DelegatedSignerReason): DelegatedSignerReadiness => ({
      configured: cfg.configured, enabled: cfg.enabled, ready: reason === "READY",
      signerId: cfg.signerId, policyId: cfg.policyId, reason,
    });
    if (!cfg.configured) return { readiness: status("NOT_CONFIGURED") };
    if (cfg.expiresAtMs <= deps.now()) return { readiness: status("SIGNER_EXPIRED") };
    if (!cfg.enabled) return { readiness: status("EXECUTION_DISABLED") };
    if (!identity.privyUserId.startsWith("did:privy:") || !identity.walletAddress) {
      return { readiness: status("WALLET_MISMATCH") };
    }
    try {
      const client = deps.createClient({ appId: PRIVY_APP_ID, appSecret: cfg.appSecret,
        maxRetries: 0, timeout: 15_000, requestExpiry: { defaultMs: 60_000 } });
      const user = await client.users()._get(identity.privyUserId);
      if (user.id !== identity.privyUserId ||
          selectPrimaryEmbeddedSolanaWallet(user.linked_accounts) !== identity.walletAddress) {
        return { readiness: status("WALLET_MISMATCH") };
      }
      const linked = (user.linked_accounts as unknown[]).map(record).find((item) => item?.type === "wallet" &&
        item.chain_type === "solana" && item.wallet_client_type === "privy" &&
        item.connector_type === "embedded" && item.wallet_index === 0 && item.address === identity.walletAddress);
      if (typeof linked?.id !== "string" || !linked.id) return { readiness: status("OWNER_CONSENT_REQUIRED") };
      const wallet = await client.wallets().get(linked.id);
      if (wallet.id !== linked.id || wallet.address !== identity.walletAddress ||
          wallet.chain_type !== "solana" || wallet.archived_at != null) {
        return { readiness: status("WALLET_MISMATCH") };
      }
      const signers = Array.isArray(wallet.additional_signers) ? wallet.additional_signers.map(record) : [];
      const matching = signers.filter((signer) => signer?.signer_id === cfg.signerId);
      if (matching.length === 0) return { readiness: status("OWNER_CONSENT_REQUIRED") };
      const policyIds = matching[0]?.override_policy_ids;
      if (matching.length !== 1 || !Array.isArray(policyIds) || policyIds.length !== 1 || policyIds[0] !== cfg.policyId) {
        return { readiness: status("SIGNER_POLICY_MISMATCH") };
      }
      if (cfg.expiresAtMs <= deps.now()) return { readiness: status("SIGNER_EXPIRED") };
      return { readiness: status("READY"), client, walletId: wallet.id, privateKey: cfg.privateKey };
    } catch {
      // Never pass provider response bodies, linked identities, or secrets to the UI.
      return { readiness: status("PRIVY_UNAVAILABLE") };
    }
  }

  return {
    async getReadiness(identity: DelegatedIdentity): Promise<DelegatedSignerReadiness> {
      return (await inspect(identity)).readiness;
    },
    async signTransaction(identity: DelegatedIdentity, input: SignInput): Promise<string> {
      const now = deps.now();
      if (!Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= now ||
          input.expiresAtMs > now + MAX_SIGNING_LIFETIME_MS ||
          !/^[A-Za-z0-9:_-]{24,128}$/.test(input.idempotencyKey) ||
          typeof input.transaction !== "string" || input.transaction.length > 1_644) {
        throw new DelegatedSignerError("INVALID_SIGNING_REQUEST");
      }
      let fingerprint: string;
      try { fingerprint = await fingerprintTransactionMessage(input.transaction); }
      catch { throw new DelegatedSignerError("INVALID_SIGNING_REQUEST"); }
      const state = await inspect(identity);
      if (!state.readiness.ready || !state.client || !state.walletId || !state.privateKey) {
        throw new DelegatedSignerError(state.readiness.reason);
      }
      if (deps.now() >= input.expiresAtMs) throw new DelegatedSignerError("INVALID_SIGNING_REQUEST");
      try {
        const result = await state.client.wallets().solana().signTransaction(state.walletId, {
          transaction: input.transaction,
          idempotency_key: input.idempotencyKey,
          request_expiry: input.expiresAtMs,
          authorization_context: { authorization_private_keys: [state.privateKey] },
        });
        if (result.encoding !== "base64") throw new Error("Invalid encoding");
        await assertSignedInvestmentTransaction(result.signed_transaction, identity.walletAddress, fingerprint);
        return result.signed_transaction;
      } catch { throw new DelegatedSignerError("SIGNING_UNAVAILABLE"); }
    },
  };
}

const delegated = createDelegatedSigner();
export const getDelegatedSignerReadiness = delegated.getReadiness;
/** Internal only: caller must validate transaction effects, reserve its policy budget, and claim submission. */
export const signDelegatedTransaction = delegated.signTransaction;
