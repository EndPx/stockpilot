import type { Asset, AssetSnapshot } from "@stockpilot/core/assets";
import {
  SOLANA_MAINNET_USDC_DECIMALS,
  SOLANA_MAINNET_USDC_MINT,
  SOLANA_NATIVE_DECIMALS,
} from "@stockpilot/core/solana";

export type TokenProgram = "spl-token" | "token-2022";

export type TokenBalance = {
  mintAddress: string;
  rawAmount: string;
  decimals: number;
  amount: string;
  program: TokenProgram;
};

export type NativeBalance = {
  rawLamports: string;
  amount: string;
};

export interface SolanaReadAdapter {
  getNativeBalance(walletAddress: string): Promise<NativeBalance>;
  getTokenBalances(walletAddress: string): Promise<TokenBalance[]>;
}

export type PortfolioPosition = {
  provider: "prestocks";
  symbol: string;
  name: string;
  mintAddress: string;
  quantity: string;
  tokenPriceUsd: number | null;
  estimatedValueUsd: number | null;
  imageUrl: string | null;
};

export type Portfolio = {
  walletAddress: string;
  funding: {
    usdc: {
      mintAddress: string;
      amount: string;
      amountUsd: number;
    };
    sol: {
      amount: string;
    };
  };
  portfolioValueUsd: number | null;
  positions: PortfolioPosition[];
  asOf: string;
};

type AssetReader = {
  getSnapshot(): Promise<AssetSnapshot>;
};

type AggregatedBalance = {
  rawAmount: bigint;
  decimals: number;
};

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token balance contains invalid decimals.");
  }
}

function parseRawAmount(rawAmount: string): bigint {
  if (!/^\d+$/.test(rawAmount)) {
    throw new Error("Token balance contains an invalid raw amount.");
  }
  return BigInt(rawAmount);
}

/** Formats integer base units without routing a raw u64 through Number. */
export function formatRawTokenAmount(rawAmount: string | bigint, decimals: number): string {
  assertDecimals(decimals);
  const value = typeof rawAmount === "bigint" ? rawAmount : parseRawAmount(rawAmount);
  if (value < 0n) throw new Error("Token balance cannot be negative.");
  if (decimals === 0) return value.toString();

  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function aggregateBalances(balances: TokenBalance[]): Map<string, AggregatedBalance> {
  const byMint = new Map<string, AggregatedBalance>();
  for (const balance of balances) {
    if (!balance.mintAddress) throw new Error("Token balance contains no mint address.");
    assertDecimals(balance.decimals);
    const rawAmount = parseRawAmount(balance.rawAmount);
    const existing = byMint.get(balance.mintAddress);
    if (existing && existing.decimals !== balance.decimals) {
      throw new Error("Token accounts for one mint disagree on decimals.");
    }
    byMint.set(balance.mintAddress, {
      decimals: balance.decimals,
      rawAmount: (existing?.rawAmount ?? 0n) + rawAmount,
    });
  }
  return byMint;
}

function estimatedValue(quantity: string, price: number | null): number | null {
  if (price === null) return null;
  const value = Number(quantity) * price;
  if (!Number.isFinite(value)) throw new Error("Portfolio valuation is outside the supported range.");
  return value;
}

function positionFor(asset: Asset, balance: AggregatedBalance): PortfolioPosition | null {
  if (balance.rawAmount === 0n) return null;
  const quantity = formatRawTokenAmount(balance.rawAmount, balance.decimals);
  return {
    provider: "prestocks",
    symbol: asset.symbol,
    name: asset.name,
    mintAddress: asset.mintAddress,
    quantity,
    tokenPriceUsd: asset.tokenPriceUsd,
    estimatedValueUsd: estimatedValue(quantity, asset.tokenPriceUsd),
    imageUrl: asset.imageUrl,
  };
}

export class PortfolioService {
  constructor(
    private readonly assets: AssetReader,
    private readonly solana: SolanaReadAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  async getPortfolio(walletAddress: string): Promise<Portfolio> {
    if (!walletAddress) throw new Error("A wallet address is required.");

    const [{ assets }, tokenBalances, nativeBalance] = await Promise.all([
      this.assets.getSnapshot(),
      this.solana.getTokenBalances(walletAddress),
      this.solana.getNativeBalance(walletAddress),
    ]);
    const byMint = aggregateBalances(tokenBalances);
    const usdc = byMint.get(SOLANA_MAINNET_USDC_MINT) ?? {
      rawAmount: 0n,
      decimals: SOLANA_MAINNET_USDC_DECIMALS,
    };
    const usdcAmount = formatRawTokenAmount(usdc.rawAmount, usdc.decimals);
    const amountUsd = Number(usdcAmount);
    if (!Number.isFinite(amountUsd)) throw new Error("USDC balance is outside the supported range.");

    const positions = assets.flatMap((asset) => {
      const balance = byMint.get(asset.mintAddress);
      if (!balance) return [];
      const position = positionFor(asset, balance);
      return position ? [position] : [];
    });
    const values = positions.map((position) => position.estimatedValueUsd);
    const portfolioValueUsd = values.some((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);

    const expectedSolAmount = formatRawTokenAmount(nativeBalance.rawLamports, SOLANA_NATIVE_DECIMALS);
    if (nativeBalance.amount !== expectedSolAmount) {
      throw new Error("Native balance amount does not match its raw lamports.");
    }
    return {
      walletAddress,
      funding: {
        usdc: {
          mintAddress: SOLANA_MAINNET_USDC_MINT,
          amount: usdcAmount,
          amountUsd,
        },
        sol: { amount: nativeBalance.amount },
      },
      portfolioValueUsd,
      positions,
      asOf: new Date(this.now()).toISOString(),
    };
  }
}
