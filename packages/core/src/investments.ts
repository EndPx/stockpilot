import type { Asset } from "@stockpilot/core/assets";
import type { Portfolio } from "@stockpilot/core/portfolio";
import {
  SOLANA_MAINNET_USDC_DECIMALS,
  SOLANA_MAINNET_USDC_MINT,
} from "@stockpilot/core/solana";
import type { JupiterExecutionAdapter, JupiterOrder } from "@stockpilot/integrations/jupiter-v2";

const MAX_U64 = 18_446_744_073_709_551_615n;

export type InvestmentErrorCode =
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_USDC"
  | "ASSET_NOT_FOUND"
  | "ASSET_NOT_ALLOWED";

export class InvestmentError extends Error {
  constructor(
    readonly code: InvestmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InvestmentError";
  }
}

export type ParsedUsdcAmount = {
  amountUsd: string;
  amountRaw: string;
};

function parseUsdcDecimal(value: string, allowZero: boolean): ParsedUsdcAmount {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new InvestmentError("INVALID_AMOUNT", "Enter a valid USDC amount with no more than six decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(SOLANA_MAINNET_USDC_DECIMALS, "0") || "0");
  if ((!allowZero && raw <= 0n) || raw > MAX_U64) {
    throw new InvestmentError("INVALID_AMOUNT", "Enter a USDC amount greater than zero.");
  }
  const normalizedFraction = fraction.replace(/0+$/, "");
  return {
    amountUsd: normalizedFraction ? `${whole}.${normalizedFraction}` : whole,
    amountRaw: raw.toString(),
  };
}

export function parseUsdcAmount(value: string): ParsedUsdcAmount {
  return parseUsdcDecimal(value, false);
}

type AssetReader = {
  getAssetBySymbol(symbol: string): Promise<Asset | null>;
};

type PortfolioReader = {
  getPortfolio(walletAddress: string): Promise<Portfolio>;
};

type MintReader = {
  getTokenDecimals(mintAddress: string): Promise<number>;
};

export type PreparedInvestment = {
  walletAddress: string;
  asset: Pick<Asset, "symbol" | "name" | "mintAddress">;
  fundingAsset: {
    symbol: "USDC";
    mintAddress: string;
  };
  inputAmountRaw: string;
  inputAmountUsd: string;
  outputAmountRaw: string;
  outputDecimals: number;
  router: string;
  mode: string;
  feeBps: number | null;
  feeMint: string | null;
  priceImpactPct: string | null;
  transaction: string;
  requestId: string;
  lastValidBlockHeight: string | null;
  expireAt: string | null;
  createdAt: string;
};

function validateOutputDecimals(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("The output mint has invalid decimals.");
  }
  return value;
}

export class InvestmentService {
  constructor(
    private readonly assets: AssetReader,
    private readonly portfolios: PortfolioReader,
    private readonly solana: MintReader,
    private readonly jupiter: JupiterExecutionAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  async prepare(input: {
    walletAddress: string;
    symbol: string;
    amountUsd: string;
  }): Promise<PreparedInvestment> {
    const amount = parseUsdcAmount(input.amountUsd);
    const asset = await this.assets.getAssetBySymbol(input.symbol);
    if (!asset) {
      throw new InvestmentError("ASSET_NOT_FOUND", "This PreStocks asset was not found.");
    }
    if (asset.provider !== "prestocks") {
      throw new InvestmentError("ASSET_NOT_ALLOWED", "Only official PreStocks assets can be purchased.");
    }

    const [portfolio, outputDecimals] = await Promise.all([
      this.portfolios.getPortfolio(input.walletAddress),
      this.solana.getTokenDecimals(asset.mintAddress),
    ]);
    if (portfolio.walletAddress !== input.walletAddress) {
      throw new Error("Portfolio wallet does not match the authenticated session.");
    }
    if (portfolio.funding.usdc.mintAddress !== SOLANA_MAINNET_USDC_MINT) {
      throw new Error("Portfolio funding asset is not canonical Solana mainnet USDC.");
    }
    const availableRaw = BigInt(parseUsdcDecimal(portfolio.funding.usdc.amount, true).amountRaw);
    if (BigInt(amount.amountRaw) > availableRaw) {
      throw new InvestmentError(
        "INSUFFICIENT_USDC",
        "Your wallet does not have enough USDC for this investment.",
      );
    }

    const order: JupiterOrder = await this.jupiter.createOrder({
      inputMint: SOLANA_MAINNET_USDC_MINT,
      outputMint: asset.mintAddress,
      amountRaw: amount.amountRaw,
      taker: input.walletAddress,
    });
    return {
      walletAddress: input.walletAddress,
      asset: { symbol: asset.symbol, name: asset.name, mintAddress: asset.mintAddress },
      fundingAsset: { symbol: "USDC", mintAddress: SOLANA_MAINNET_USDC_MINT },
      inputAmountRaw: amount.amountRaw,
      inputAmountUsd: amount.amountUsd,
      outputAmountRaw: order.outAmount,
      outputDecimals: validateOutputDecimals(outputDecimals),
      router: order.router,
      mode: order.mode,
      feeBps: order.feeBps,
      feeMint: order.feeMint,
      priceImpactPct: order.priceImpactPct,
      transaction: order.transaction,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight,
      expireAt: order.expireAt,
      createdAt: new Date(this.now()).toISOString(),
    };
  }
}
