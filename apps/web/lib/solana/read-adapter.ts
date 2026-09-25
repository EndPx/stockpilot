import "server-only";

import { address, createSolanaRpc, isAddress, mainnet } from "@solana/kit";
import {
  formatRawTokenAmount,
  type NativeBalance,
  type SolanaReadAdapter,
  type TokenBalance,
  type TokenProgram,
} from "@stockpilot/core/portfolio";
import {
  SOLANA_MAINNET_RPC_URL,
  SOLANA_NATIVE_DECIMALS,
  SPL_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@stockpilot/core/solana";

type RpcRequest<T> = {
  send(options?: { abortSignal?: AbortSignal }): Promise<T>;
};

export type SolanaPortfolioRpc = {
  getBalance(owner: unknown, config: { commitment: "confirmed" }): RpcRequest<{ value: bigint }>;
  getTokenAccountsByOwner(
    owner: unknown,
    filter: { programId: unknown },
    config: { commitment: "confirmed"; encoding: "jsonParsed" },
  ): RpcRequest<{ context?: { slot: bigint }; value: unknown }>;
  getAccountInfo(
    mint: unknown,
    config: { commitment: "confirmed"; encoding: "jsonParsed"; minContextSlot: bigint },
  ): RpcRequest<{ context?: { slot: bigint }; value: unknown }>;
  getTokenSupply(
    mint: unknown,
    config: { commitment: "confirmed" },
  ): RpcRequest<{ value: { decimals: number } }>;
  getBlockHeight(config: { commitment: "confirmed" }): RpcRequest<bigint>;
};

export class SolanaBalanceReadError extends Error {
  constructor(options?: ErrorOptions) {
    super("Solana RPC balance read failed.", options);
    this.name = "SolanaBalanceReadError";
  }
}

export class SolanaInvestmentReadError extends Error {
  constructor(options?: ErrorOptions) {
    super("Solana RPC investment read failed.", options);
    this.name = "SolanaInvestmentReadError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function contextSlot(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

function positiveMultiplier(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value !== "string" || value.length > 96 ||
      !/^\d+(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function validI64Timestamp(value: unknown): boolean {
  let timestamp: bigint;
  if (typeof value === "bigint") timestamp = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) timestamp = BigInt(value);
  else if (typeof value === "string" && /^-?\d{1,19}$/.test(value)) timestamp = BigInt(value);
  else return false;
  return timestamp >= -(1n << 63n) && timestamp <= (1n << 63n) - 1n;
}

function readParsedTokenAccount(value: unknown, program: TokenProgram, slot: bigint | null): TokenBalance {
  const account = record(record(value)?.account);
  const data = record(account?.data);
  const parsed = record(data?.parsed);
  const info = record(parsed?.info);
  const tokenAmount = record(info?.tokenAmount);
  const mintAddress = info?.mint;
  const rawAmount = tokenAmount?.amount;
  const decimals = tokenAmount?.decimals;

  if (
    parsed?.type !== "account" ||
    typeof mintAddress !== "string" ||
    !isAddress(mintAddress) ||
    typeof rawAmount !== "string" ||
    typeof decimals !== "number"
  ) {
    throw new SolanaBalanceReadError({ cause: new Error("Malformed parsed token account.") });
  }

  let amount: string;
  try {
    amount = formatRawTokenAmount(rawAmount, decimals);
  } catch (cause) {
    throw new SolanaBalanceReadError({ cause });
  }
  const rpcUiAmountString = tokenAmount?.uiAmountString;
  return {
    mintAddress, rawAmount, decimals, amount, program,
    ...(program === "token-2022" && slot !== null && typeof rpcUiAmountString === "string"
      ? { rpcUiAmountString, contextSlot: slot } : {}),
  };
}

export function normalizeTokenAccounts(value: unknown, program: TokenProgram, slot: bigint | null = null): TokenBalance[] {
  if (!Array.isArray(value)) {
    throw new SolanaBalanceReadError({ cause: new Error("Malformed token-account collection.") });
  }
  return value.map((account) => readParsedTokenAccount(account, program, slot));
}

/** A parsed balance is trusted for display only after its held mint is independently verified. */
export function isVerifiedScaledUiMint(value: unknown, expectedDecimals: number): boolean {
  const account = record(value);
  const data = record(account?.data);
  const parsed = record(data?.parsed);
  const info = record(parsed?.info);
  if (account?.owner !== TOKEN_2022_PROGRAM_ADDRESS || data?.program !== "spl-token-2022" ||
      parsed?.type !== "mint" || info?.decimals !== expectedDecimals || info?.isInitialized !== true ||
      !Array.isArray(info.extensions)) return false;
  const scaled = info.extensions.filter((entry: unknown) => record(entry)?.extension === "scaledUiAmountConfig");
  const state = scaled.length === 1 ? record(record(scaled[0])?.state) : null;
  return state !== null && positiveMultiplier(state.multiplier) && positiveMultiplier(state.newMultiplier) &&
    validI64Timestamp(state.newMultiplierEffectiveTimestamp);
}

export function normalizeNativeBalance(value: unknown): NativeBalance {
  if (typeof value !== "bigint" || value < 0n) {
    throw new SolanaBalanceReadError({ cause: new Error("Malformed native balance.") });
  }
  return {
    rawLamports: value.toString(),
    amount: formatRawTokenAmount(value, SOLANA_NATIVE_DECIMALS),
  };
}

export class SolanaRpcReadAdapter implements SolanaReadAdapter {
  constructor(private readonly rpc: SolanaPortfolioRpc) {}

  async getNativeBalance(walletAddress: string): Promise<NativeBalance> {
    try {
      const response = await this.rpc
        .getBalance(address(walletAddress), { commitment: "confirmed" })
        .send({ abortSignal: AbortSignal.timeout(10_000) });
      return normalizeNativeBalance(response.value);
    } catch (cause) {
      if (cause instanceof SolanaBalanceReadError) throw cause;
      throw new SolanaBalanceReadError({ cause });
    }
  }

  async getTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    try {
      const owner = address(walletAddress);
      const requests = [
        {
          program: "spl-token" as const,
          address: SPL_TOKEN_PROGRAM_ADDRESS,
        },
        {
          program: "token-2022" as const,
          address: TOKEN_2022_PROGRAM_ADDRESS,
        },
      ].map(async ({ program, address: programAddress }) => {
        const response = await this.rpc
          .getTokenAccountsByOwner(
            owner,
            { programId: address(programAddress) },
            { commitment: "confirmed", encoding: "jsonParsed" },
          )
          .send({ abortSignal: AbortSignal.timeout(10_000) });
        return normalizeTokenAccounts(response.value, program, contextSlot(response.context?.slot));
      });
      return (await Promise.all(requests)).flat();
    } catch (cause) {
      if (cause instanceof SolanaBalanceReadError) throw cause;
      throw new SolanaBalanceReadError({ cause });
    }
  }

  async verifyScaledUiMint(mintAddress: string, decimals: number, minContextSlot: bigint): Promise<boolean> {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || minContextSlot < 0n) return false;
    try {
      const response = await this.rpc.getAccountInfo(address(mintAddress), {
        commitment: "confirmed", encoding: "jsonParsed", minContextSlot,
      }).send({ abortSignal: AbortSignal.timeout(10_000) });
      const slot = contextSlot(response.context?.slot);
      return slot !== null && slot >= minContextSlot && isVerifiedScaledUiMint(response.value, decimals);
    } catch {
      // A missing mint, unsupported RPC parser, or failed read must not invent a displayed position.
      return false;
    }
  }

  async getTokenDecimals(mintAddress: string): Promise<number> {
    try {
      const response = await this.rpc
        .getTokenSupply(address(mintAddress), { commitment: "confirmed" })
        .send({ abortSignal: AbortSignal.timeout(10_000) });
      const decimals = response.value.decimals;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
        throw new Error("Malformed token decimals.");
      }
      return decimals;
    } catch (cause) {
      throw new SolanaInvestmentReadError({ cause });
    }
  }

  async getCurrentBlockHeight(): Promise<bigint> {
    try {
      const value = await this.rpc
        .getBlockHeight({ commitment: "confirmed" })
        .send({ abortSignal: AbortSignal.timeout(10_000) });
      if (typeof value !== "bigint" || value < 0n) throw new Error("Malformed block height.");
      return value;
    } catch (cause) {
      throw new SolanaInvestmentReadError({ cause });
    }
  }
}

export function getSolanaRpcUrl(): string {
  const value = process.env.SOLANA_RPC_URL ?? SOLANA_MAINNET_RPC_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SOLANA_RPC_URL must be a valid HTTP(S) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SOLANA_RPC_URL must be a valid HTTP(S) URL.");
  }
  return parsed.href;
}

export function createSolanaReadAdapter(): SolanaRpcReadAdapter {
  const rpc = createSolanaRpc(mainnet(getSolanaRpcUrl()));
  return new SolanaRpcReadAdapter(rpc as unknown as SolanaPortfolioRpc);
}
