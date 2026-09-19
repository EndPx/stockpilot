export const JUPITER_QUOTE_API_URL = "https://api.jup.ag/swap/v1/quote";

export type JupiterQuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
};

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  outputAmountRaw: string;
  minimumOutputRaw: string;
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
  raw: unknown;
};

type JupiterApiQuote = {
  inputMint?: unknown;
  outputMint?: unknown;
  inAmount?: unknown;
  outAmount?: unknown;
  otherAmountThreshold?: unknown;
  priceImpactPct?: unknown;
  slippageBps?: unknown;
  routePlan?: unknown;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Jupiter quote response is missing ${field}.`);
  }
  return value;
}

function getRouteLabels(routePlan: unknown): string[] {
  if (!Array.isArray(routePlan)) return [];

  return routePlan.flatMap((route) => {
    if (typeof route !== "object" || route === null) return [];
    const swapInfo = (route as { swapInfo?: unknown }).swapInfo;
    if (typeof swapInfo !== "object" || swapInfo === null) return [];
    const label = (swapInfo as { label?: unknown }).label;
    return typeof label === "string" ? [label] : [];
  });
}

/** Retrieves an ExactIn swap quote from Jupiter's current Swap API. */
export async function getJupiterQuote(request: JupiterQuoteRequest): Promise<JupiterQuote> {
  if (request.amount <= 0n) throw new Error("Jupiter quote amount must be greater than zero.");
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0) {
    throw new Error("Jupiter quote slippageBps must be a non-negative integer.");
  }

  const url = new URL(JUPITER_QUOTE_API_URL);
  url.search = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount.toString(),
    slippageBps: request.slippageBps.toString(),
  }).toString();

  const apiKey = process.env.JUPITER_API_KEY;
  const response = await fetch(url, {
    headers: apiKey ? { "x-api-key": apiKey } : undefined,
  });
  if (!response.ok) throw new Error(`Jupiter quote request failed with HTTP ${response.status}.`);

  const raw: unknown = await response.json();
  const quote = raw as JupiterApiQuote;
  const priceImpactPct = Number(quote.priceImpactPct);
  const slippageBps = quote.slippageBps;

  if (
    !Number.isFinite(priceImpactPct) ||
    typeof slippageBps !== "number" ||
    !Number.isInteger(slippageBps)
  ) {
    throw new Error("Jupiter quote response contains invalid numeric fields.");
  }

  return {
    inputMint: requiredString(quote.inputMint, "inputMint"),
    outputMint: requiredString(quote.outputMint, "outputMint"),
    inputAmountRaw: requiredString(quote.inAmount, "inAmount"),
    outputAmountRaw: requiredString(quote.outAmount, "outAmount"),
    minimumOutputRaw: requiredString(quote.otherAmountThreshold, "otherAmountThreshold"),
    priceImpactPct,
    slippageBps,
    routeLabels: getRouteLabels(quote.routePlan),
    raw,
  };
}
