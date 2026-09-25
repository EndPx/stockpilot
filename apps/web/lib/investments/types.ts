export type InvestmentApiErrorCode =
  | "INVESTMENTS_DISABLED"
  | "UNAUTHENTICATED"
  | "INVALID_REQUEST"
  | "WALLET_MISMATCH"
  | "ASSET_NOT_FOUND"
  | "ASSET_NOT_ALLOWED"
  | "ASSET_CATALOG_STALE"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_USDC"
  | "JUPITER_ORDER_FAILED"
  | "JUPITER_ORDER_NOT_EXECUTABLE"
  | "INVESTMENT_ORDER_UNVERIFIED"
  | "UNRESOLVED_TRADE"
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
    providerRequestId: string;
    asset: { symbol: string; name: string; mintAddress: string };
    fundingAsset: { symbol: "USDC"; mintAddress: string };
    inputAmountRaw: string;
    inputAmountUsd: string;
    outputAmountRaw: string;
    estimatedOutputAmount: string;
    requiredMinimumOutputRaw: string;
    minimumOutputAmount: string;
    maximumWalletNativeDebitLamportsRaw: string;
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
    status: "PENDING" | "CONFIRMED" | "FAILED";
    side: "BUY" | "SELL";
    providerRequestId: string;
    transactionSignature: string;
    actualInputAmountRaw: string | null;
    actualOutputAmountRaw: string | null;
    solscanUrl: string;
  };
};

export type ManualInvestmentStatusResponse = {
  execution: {
    status: "CLAIMED" | "SUBMITTED" | "UNKNOWN" | "CONFIRMED" | "FAILED" | "REVIEW_REQUIRED";
    ledgerStatus: "CLAIMED" | "SUBMITTED" | "UNKNOWN" | "CONFIRMED" | "FAILED";
    side?: "BUY" | "SELL";
    providerRequestId: string;
    transactionSignature: string;
    actualInputAmountRaw: string | null;
    actualOutputAmountRaw: string | null;
    actualWalletNativeDebitLamportsRaw: string | null;
  };
};

export type ActiveManualInvestmentStatusResponse = {
  execution: ManualInvestmentStatusResponse["execution"] | null;
};
