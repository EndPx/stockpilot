import type { AgentOperationLimit, AgentWalletPolicy, AgentWalletPolicyInput } from "./agent-operations";

export const EXECUTION_POLICY_ASSETS = [
  { id: "prestocks:Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", label: "Polymarket PreStocks", unit: "Polymarket tokens", decimals: 9 },
  { id: "xstocks:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", label: "AAPLx", unit: "AAPLx base tokens", decimals: 8 },
] as const;

export type ExecutionLimitDraft = {
  perOperation: string; daily: string; unlimitedPerOperation: boolean; unlimitedDaily: boolean;
};
export type ExecutionPolicyDraft = Omit<AgentWalletPolicyInput,
  "buyLimit" | "transferSolLimit" | "transferUsdcLimit" | "sellLimits" | "eligibility" | "expiresAt" | "recipientAllowlist"> & {
  buyLimit: ExecutionLimitDraft; transferSolLimit: ExecutionLimitDraft; transferUsdcLimit: ExecutionLimitDraft;
  sellLimits: Record<string, ExecutionLimitDraft>; recipientText: string;
  noExpiry: boolean; expiry: string; countryCode: "" | "ID"; nonUsPerson: boolean; acceptedTerms: boolean;
};

const MAX_U64 = 18_446_744_073_709_551_615n;

/** Decimal strings only: never round a spending limit through a JS number. */
export function executionAmountRaw(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 1 || decimals > 9 ||
      !new RegExp(`^(?:0|[1-9]\\d{0,19})(?:\\.\\d{1,${decimals}})?$`).test(value)) {
    throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount <= 0n || amount > MAX_U64) throw new Error("The limit must be positive and fit the token's supported range.");
  return amount.toString();
}

export function executionAmountDisplay(raw: string, decimals: number): string {
  const digits = raw.padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

function draftLimit(limit: AgentOperationLimit, decimals: number): ExecutionLimitDraft {
  return { perOperation: executionAmountDisplay(limit.perOperationRaw ?? "1000000", decimals),
    daily: executionAmountDisplay(limit.dailyRaw ?? "10000000", decimals),
    unlimitedPerOperation: limit.unlimitedPerOperation, unlimitedDaily: limit.unlimitedDaily };
}
function localDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function executionPolicyDraft(policy: AgentWalletPolicy): ExecutionPolicyDraft {
  return { automationOptIn: policy.automationOptIn, buyEnabled: policy.buyEnabled,
    sellEnabled: policy.sellEnabled, transferSolEnabled: policy.transferSolEnabled,
    transferUsdcEnabled: policy.transferUsdcEnabled, allowedAssetIds: [...policy.allowedAssetIds],
    anyRecipient: policy.anyRecipient, recipientText: policy.recipientAllowlist.join(", "),
    buyLimit: draftLimit(policy.buyLimit, 6), transferSolLimit: draftLimit(policy.transferSolLimit, 9),
    transferUsdcLimit: draftLimit(policy.transferUsdcLimit, 6),
    sellLimits: Object.fromEntries(EXECUTION_POLICY_ASSETS.map((asset) => [asset.id,
      draftLimit(policy.sellLimits.find((entry) => entry.assetId === asset.id)?.limit ?? {
        perOperationRaw: (10n ** BigInt(asset.decimals)).toString(),
        dailyRaw: (10n ** BigInt(asset.decimals + 1)).toString(),
        unlimitedPerOperation: false, unlimitedDaily: false,
      }, asset.decimals)])),
    noExpiry: policy.expiresAt === null, expiry: policy.expiresAt ? localDateTime(policy.expiresAt) : "",
    countryCode: policy.eligibility?.countryCode ?? "", nonUsPerson: policy.eligibility?.nonUsPerson ?? false,
    acceptedTerms: policy.eligibility?.acceptedTerms ?? false };
}

function savedLimit(limit: ExecutionLimitDraft, decimals: number): AgentOperationLimit {
  return { perOperationRaw: limit.unlimitedPerOperation ? null : executionAmountRaw(limit.perOperation.trim(), decimals),
    dailyRaw: limit.unlimitedDaily ? null : executionAmountRaw(limit.daily.trim(), decimals),
    unlimitedPerOperation: limit.unlimitedPerOperation, unlimitedDaily: limit.unlimitedDaily };
}

export function executionPolicyInput(draft: ExecutionPolicyDraft, now = Date.now()): AgentWalletPolicyInput {
  const eligibility = draft.countryCode === "ID" && draft.nonUsPerson && draft.acceptedTerms
    ? { countryCode: "ID" as const, nonUsPerson: true as const, acceptedTerms: true as const } : null;
  const allowedAssetIds = EXECUTION_POLICY_ASSETS.filter((asset) => draft.allowedAssetIds.includes(asset.id)).map((asset) => asset.id);
  const recipientAllowlist = draft.anyRecipient ? [] : draft.recipientText.split(/[\s,]+/).filter(Boolean);
  const trading = draft.buyEnabled || draft.sellEnabled;
  const transfers = draft.transferSolEnabled || draft.transferUsdcEnabled;
  if (draft.automationOptIn) {
    if (!trading && !transfers) throw new Error("Choose at least one wallet action or turn automation off.");
    if (trading && (!eligibility || allowedAssetIds.length === 0)) throw new Error("Choose a supported asset and confirm the investor eligibility statements.");
    if (transfers && !draft.anyRecipient && recipientAllowlist.length === 0) throw new Error("Add at least one recipient, or explicitly allow any recipient.");
  }
  if (recipientAllowlist.length > 100 || new Set(recipientAllowlist).size !== recipientAllowlist.length ||
      recipientAllowlist.some((recipient) => !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient))) {
    throw new Error("Use unique Solana public addresses, separated by commas (maximum 100).");
  }
  const expiry = draft.noExpiry ? null : Date.parse(draft.expiry);
  if (expiry !== null && (!Number.isFinite(expiry) || expiry <= now)) throw new Error("Choose a future policy expiry in your local time.");
  return { automationOptIn: draft.automationOptIn, buyEnabled: draft.buyEnabled, sellEnabled: draft.sellEnabled,
    transferSolEnabled: draft.transferSolEnabled, transferUsdcEnabled: draft.transferUsdcEnabled,
    expiresAt: expiry === null ? null : new Date(expiry).toISOString(), allowedAssetIds,
    buyLimit: savedLimit(draft.buyLimit, 6), transferSolLimit: savedLimit(draft.transferSolLimit, 9),
    transferUsdcLimit: savedLimit(draft.transferUsdcLimit, 6),
    sellLimits: EXECUTION_POLICY_ASSETS.filter((asset) => allowedAssetIds.includes(asset.id)).map((asset) => ({
      assetId: asset.id, limit: savedLimit(draft.sellLimits[asset.id], asset.decimals),
    })), recipientAllowlist, anyRecipient: draft.anyRecipient, eligibility };
}

export function executionPolicyActions(policy: Pick<AgentWalletPolicyInput,
  "buyEnabled" | "sellEnabled" | "transferSolEnabled" | "transferUsdcEnabled">): string[] {
  return [policy.buyEnabled && "BUY", policy.sellEnabled && "SELL", policy.transferSolEnabled && "transfer SOL",
    policy.transferUsdcEnabled && "transfer USDC"].filter((item): item is string => Boolean(item));
}

export function executionPolicyConfirmation(name: string, policy: AgentWalletPolicyInput): string {
  const limitText = (label: string, limit: AgentOperationLimit, decimals: number, unit: string) =>
    `${label}: ${limit.perOperationRaw === null ? "UNLIMITED per operation" : `${executionAmountDisplay(limit.perOperationRaw, decimals)} ${unit} per operation`}, ` +
    `${limit.dailyRaw === null ? "UNLIMITED over 24 hours" : `${executionAmountDisplay(limit.dailyRaw, decimals)} ${unit} over 24 hours`}.`;
  const details = [
    (policy.buyEnabled || policy.sellEnabled) && `Allowed assets: ${EXECUTION_POLICY_ASSETS.filter((asset) => policy.allowedAssetIds.includes(asset.id)).map((asset) => asset.label).join(", ")}.`,
    policy.buyEnabled && limitText("BUY", policy.buyLimit, 6, "USDC"),
    ...(policy.sellEnabled ? policy.sellLimits.map(({ assetId, limit }) => {
      const asset = EXECUTION_POLICY_ASSETS.find((item) => item.id === assetId)!;
      return limitText(`SELL ${asset.label}`, limit, asset.decimals, asset.unit);
    }) : []),
    policy.transferSolEnabled && limitText("Transfer SOL", policy.transferSolLimit, 9, "SOL"),
    policy.transferUsdcEnabled && limitText("Transfer USDC", policy.transferUsdcLimit, 6, "USDC"),
    (policy.transferSolEnabled || policy.transferUsdcEnabled) && (policy.anyRecipient
      ? "Transfers may go to ANY supported wallet recipient." : `Transfers are restricted to ${policy.recipientAllowlist.length} saved recipient(s).`),
  ].filter(Boolean).join(" ");
  return `Allow ${name} to ${executionPolicyActions(policy).join(", ")} without your approval for each transaction? ${details} ` +
    (policy.expiresAt ? `Policy expires ${new Date(policy.expiresAt).toISOString()}. ` : "This policy has no expiry. ") +
    "Wallet automation needs its own separate permission; this save does not connect it. You can turn these actions off for future signing at any time.";
}
