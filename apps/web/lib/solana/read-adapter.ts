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
  ): RpcRequest<{ value: unknown }>;
};

export class SolanaBalanceReadError extends Error {
  constructor(options?: ErrorOptions) {
    super("Solana RPC balance read failed.", options);
    this.name = "SolanaBalanceReadError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readParsedTokenAccount(value: unknown, program: TokenProgram): TokenBalance {
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
  return { mintAddress, rawAmount, decimals, amount, program };
}

export function normalizeTokenAccounts(value: unknown, program: TokenProgram): TokenBalance[] {
  if (!Array.isArray(value)) {
    throw new SolanaBalanceReadError({ cause: new Error("Malformed token-account collection.") });
  }
  return value.map((account) => readParsedTokenAccount(account, program));
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
        return normalizeTokenAccounts(response.value, program);
      });
      return (await Promise.all(requests)).flat();
    } catch (cause) {
      if (cause instanceof SolanaBalanceReadError) throw cause;
      throw new SolanaBalanceReadError({ cause });
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
