import { formatRawTokenAmount } from "@stockpilot/core/portfolio";

export type ScaleConfig = { multiplier: string; newMultiplier: string; newMultiplierEffectiveTimestamp: string };
export type TokenAmountSemantics = {
  rawAmount: string; decimals: number; baseUiAmount: string;
  scaleMultiplier: string | null;
  /** Exact decimal calculation, truncated to mint decimals; not a float-RPC reproduction. */
  calculatedScaledUiAmount: string | null;
  /** Prefer a same-context RPC uiAmountString; never multiply that string a second time. */
  displayAmount: string;
  displaySource: "RAW_DECIMALS" | "RPC_SCALED" | "DECIMAL_SCALE_ESTIMATE";
};

export function parseRawU64(raw: string): bigint {
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,19})$/.test(raw)) throw new Error("Invalid raw u64 amount.");
  const value = BigInt(raw);
  if (value > 18446744073709551615n) throw new Error("Raw amount exceeds u64.");
  return value;
}

function ratio(value: string): [bigint, bigint] {
  if (typeof value !== "string" || value.length > 96) throw new Error("Invalid scale multiplier.");
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(value);
  if (!match) throw new Error("Invalid scale multiplier.");
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (Math.abs(exponent) > 400) throw new Error("Scale exponent out of bounds.");
  const numerator = BigInt(match[1] + (match[2] ?? ""));
  if (numerator <= 0n) throw new Error("Scale must be positive.");
  return exponent >= 0 ? [numerator * 10n ** BigInt(exponent), 1n] : [numerator, 10n ** BigInt(-exponent)];
}

export function effectiveMultiplier(scale: ScaleConfig, unixSeconds: bigint): string {
  ratio(scale.multiplier); ratio(scale.newMultiplier);
  if (!/^-?\d{1,19}$/.test(scale.newMultiplierEffectiveTimestamp)) throw new Error("Invalid scale activation time.");
  const activation = BigInt(scale.newMultiplierEffectiveTimestamp);
  if (activation < -(2n ** 63n) || activation > 2n ** 63n - 1n) throw new Error("Scale time exceeds i64.");
  return unixSeconds >= activation ? scale.newMultiplier : scale.multiplier;
}

export function normalizeTokenAmount(input: {
  rawAmount: string; decimals: number; scale?: ScaleConfig | null; unixSeconds: bigint;
  /** Only pass a uiAmountString from the same mint/account observation, not client input. */
  rpcUiAmountString?: string;
}): TokenAmountSemantics {
  const raw = parseRawU64(input.rawAmount);
  const baseUiAmount = formatRawTokenAmount(raw, input.decimals);
  if (!input.scale) return { rawAmount: input.rawAmount, decimals: input.decimals, baseUiAmount, scaleMultiplier: null, calculatedScaledUiAmount: null, displayAmount: baseUiAmount, displaySource: "RAW_DECIMALS" };
  const scaleMultiplier = effectiveMultiplier(input.scale, input.unixSeconds);
  const [numerator, denominator] = ratio(scaleMultiplier);
  const calculatedScaledUiAmount = formatRawTokenAmount(raw * numerator / denominator, input.decimals);
  const rpc = input.rpcUiAmountString;
  if (rpc !== undefined && (typeof rpc !== "string" || rpc.length > 800 || !/^\d+(?:\.\d+)?$/.test(rpc))) throw new Error("Invalid RPC display amount.");
  return {
    rawAmount: input.rawAmount, decimals: input.decimals, baseUiAmount, scaleMultiplier, calculatedScaledUiAmount,
    displayAmount: rpc ?? calculatedScaledUiAmount, displaySource: rpc === undefined ? "DECIMAL_SCALE_ESTIMATE" : "RPC_SCALED",
  };
}
