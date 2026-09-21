export type InvestmentApiErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_REQUEST"
  | "WALLET_MISMATCH"
  | "ASSET_NOT_FOUND"
  | "ASSET_NOT_ALLOWED"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_USDC"
  | "JUPITER_ORDER_FAILED"
  | "JUPITER_ORDER_NOT_EXECUTABLE"
  | "JUPITER_ORDER_EXPIRED"
  | "INVESTMENT_TOKEN_INVALID"
  | "INVESTMENT_TOKEN_EXPIRED"
  | "TRANSACTION_MISMATCH"
  | "JUPITER_EXECUTION_FAILED"
  | "TRANSACTION_FAILED"
  | "PROVIDER_UNAVAILABLE";

export type InvestmentApiErrorBody = {
  error: {
    code: InvestmentApiErrorCode;
    message: string;
  };
};

export type PreparedInvestmentResponse = {
  investment: {
    walletAddress: string;
    asset: { symbol: string; name: string; mintAddress: string };
    fundingAsset: { symbol: "USDC"; mintAddress: string };
    inputAmountRaw: string;
    inputAmountUsd: string;
    outputAmountRaw: string;
    estimatedOutputAmount: string;
    router: string;
    mode: string;
    feeBps: number | null;
    feeMint: string | null;
    priceImpactPct: string | null;
    expiresAt: string;
  };
  transaction: string;
  investmentToken: string;
};

export type InvestmentExecutionResponse = {
  execution: {
    status: "success";
    symbol: string;
    signature: string;
    inputAmountRaw: string;
    inputAmountUsd: string;
    outputAmountRaw: string;
    outputAmount: string;
    solscanUrl: string;
  };
};
