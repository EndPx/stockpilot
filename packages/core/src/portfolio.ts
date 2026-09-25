import { assertAssetIdentity, type InvestmentAsset } from "@stockpilot/integrations/asset-domain";
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
  provider: InvestmentAsset["provider"];
  assetId?: string;
  marketType?: InvestmentAsset["marketType"];
  symbol: string;
  name: string;
  mintAddress: string;
  /** Display quantity, null when Token-2022 Scaled UI semantics have not been verified. */
  quantity: string | null;
  /** On-chain base units, never an equity-adjusted display quantity. */
  rawTokenAmount?: string;
  decimals?: number;
  displayStatus?: "RAW_DECIMALS" | "MULTIPLIER_UNVERIFIED";
  tokenPriceUsd: number | null;
  priceSource?: "prestocks_issuer" | "xstocks_issuer" | null;
  priceAsOf?: string | null;
  priceStale?: boolean;
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
  /** Investment positions only; USDC cash and SOL network balance are excluded. */
  valuationScope?: "INVESTMENT_POSITIONS_ONLY";
  positions: PortfolioPosition[];
  /** Nonzero SPL mints outside the current canonical catalog are omitted, not valued as zero. */
  unrecognizedTokenMintCount?: number;
  asOf: string;
};

type AssetReader = {
  getSnapshot(): Promise<{ assets: InvestmentAsset[]; fetchedAt?: string; stale?: boolean;
    sources?: { provider: InvestmentAsset["provider"]; fetchedAt: string; stale: boolean }[] }>;
  /** Optional issuer quote lookup for held assets only; missing quotes remain unvalued. */
  getHeldIndicativePrices?(assets: readonly InvestmentAsset[]): Promise<Map<string, {
    quote: number | null; fetchedAt: string | null; stale: boolean;
  }>>;
};

export type WalletBalance = {
  walletAddress: string;
  funding: Portfolio["funding"];
  asOf: string;
  source: "solana_rpc";
  commitment: "confirmed";
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
    if (balance.amount !== formatRawTokenAmount(rawAmount, balance.decimals)) {
      throw new Error("Token balance amount does not match its raw amount.");
    }
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

function positionFor(asset: InvestmentAsset, balance: AggregatedBalance, tokenPriceUsd: number | null,
  priceAsOf: string | null, priceStale: boolean): PortfolioPosition | null {
  if (balance.rawAmount === 0n) return null;
  // xStocks on Solana use Token-2022 Scaled UI Amount. A raw SPL balance is
  // not the equity-adjusted display quantity, so never value it by raw units.
  const needsScale = asset.provider === "xstocks";
  const quantity = needsScale ? null : formatRawTokenAmount(balance.rawAmount, balance.decimals);
  return {
    provider: asset.provider,
    assetId: asset.id,
    marketType: asset.marketType,
    symbol: asset.symbol,
    name: asset.name,
    mintAddress: asset.mintAddress,
    quantity,
    rawTokenAmount: balance.rawAmount.toString(),
    decimals: balance.decimals,
    displayStatus: needsScale ? "MULTIPLIER_UNVERIFIED" : "RAW_DECIMALS",
    tokenPriceUsd,
    priceSource: tokenPriceUsd === null ? null : asset.provider === "xstocks" ? "xstocks_issuer" : "prestocks_issuer",
    priceAsOf,
    priceStale,
    estimatedValueUsd: quantity === null ? null : estimatedValue(quantity, tokenPriceUsd),
    imageUrl: asset.imageUrl,
  };
}

export class PortfolioService {
  constructor(
    private readonly assets: AssetReader,
    private readonly solana: SolanaReadAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  private async readWallet(walletAddress: string) {
    if (!walletAddress) throw new Error("A wallet address is required.");
    const [tokenBalances, nativeBalance] = await Promise.all([
      this.solana.getTokenBalances(walletAddress),
      this.solana.getNativeBalance(walletAddress),
    ]);
    const byMint = aggregateBalances(tokenBalances);
    const usdc = byMint.get(SOLANA_MAINNET_USDC_MINT) ?? {
      rawAmount: 0n,
      decimals: SOLANA_MAINNET_USDC_DECIMALS,
    };
    if (usdc.decimals !== SOLANA_MAINNET_USDC_DECIMALS) {
      throw new Error("Canonical USDC balance has unexpected decimals.");
    }
    const usdcAmount = formatRawTokenAmount(usdc.rawAmount, usdc.decimals);
    const amountUsd = Number(usdcAmount);
    if (!Number.isFinite(amountUsd)) throw new Error("USDC balance is outside the supported range.");

    const expectedSolAmount = formatRawTokenAmount(nativeBalance.rawLamports, SOLANA_NATIVE_DECIMALS);
    if (nativeBalance.amount !== expectedSolAmount) {
      throw new Error("Native balance amount does not match its raw lamports.");
    }
    return { byMint, funding: {
        usdc: {
          mintAddress: SOLANA_MAINNET_USDC_MINT,
          amount: usdcAmount,
          amountUsd,
        },
        sol: { amount: nativeBalance.amount },
      } };
  }

  /** Funding balances need only Solana RPC; an issuer outage must not hide SOL or USDC. */
  async getBalance(walletAddress: string): Promise<WalletBalance> {
    const { funding } = await this.readWallet(walletAddress);
    return { walletAddress, funding, asOf: new Date(this.now()).toISOString(),
      source: "solana_rpc", commitment: "confirmed" };
  }

  async getPortfolio(walletAddress: string): Promise<Portfolio> {
    if (!walletAddress) throw new Error("A wallet address is required.");
    const [snapshot, wallet] = await Promise.all([this.assets.getSnapshot(), this.readWallet(walletAddress)]);
    const { assets } = snapshot;
    const { byMint, funding } = wallet;
    const seen = new Set<string>();
    for (const asset of assets) {
      assertAssetIdentity(asset);
      if (seen.has(asset.mintAddress) || asset.mintAddress === SOLANA_MAINNET_USDC_MINT) {
        throw new Error("Portfolio catalog contains an ambiguous mint.");
      }
      seen.add(asset.mintAddress);
    }
    const held = assets.filter((asset) => (byMint.get(asset.mintAddress)?.rawAmount ?? 0n) > 0n);
    let indicativePrices = new Map<string, { quote: number | null; fetchedAt: string | null; stale: boolean }>();
    if (this.assets.getHeldIndicativePrices) {
      try { indicativePrices = await this.assets.getHeldIndicativePrices(held); }
      catch { /* A quote outage leaves affected holdings unvalued, never zero-valued. */ }
    }
    const positions = held.map((asset) => {
      const issuerPrice = indicativePrices.get(asset.mintAddress);
      const price = asset.provider === "xstocks" ? issuerPrice?.quote ?? null : asset.tokenPriceUsd;
      const source = snapshot.sources?.find(({ provider }) => provider === asset.provider);
      const priceAsOf = asset.provider === "xstocks" ? issuerPrice?.fetchedAt ?? null : source?.fetchedAt ?? snapshot.fetchedAt ?? null;
      const priceStale = asset.provider === "xstocks"
        ? (issuerPrice?.stale ?? true) || (source?.stale ?? snapshot.stale ?? true)
        : source?.stale ?? snapshot.stale ?? true;
      if (price !== null && (!Number.isFinite(price) || price <= 0)) {
        throw new Error("Portfolio contains an invalid indicative price.");
      }
      return positionFor(asset, byMint.get(asset.mintAddress)!, price, priceAsOf, priceStale)!;
    });
    const values = positions.map((position) => position.estimatedValueUsd);
    const portfolioValueUsd = values.some((value) => value === null)
      ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);
    const unrecognizedTokenMintCount = [...byMint].filter(([mint, balance]) =>
      balance.rawAmount > 0n && mint !== SOLANA_MAINNET_USDC_MINT && !seen.has(mint)).length;
    return { walletAddress, funding, portfolioValueUsd, valuationScope: "INVESTMENT_POSITIONS_ONLY", positions,
      unrecognizedTokenMintCount, asOf: new Date(this.now()).toISOString() };
  }
}
