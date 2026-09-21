import assert from "node:assert/strict";
import test from "node:test";
import type { Asset } from "@stockpilot/core/assets";
import { InvestmentError, InvestmentService, parseUsdcAmount } from "@stockpilot/core/investments";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import type { JupiterExecutionAdapter, JupiterOrder } from "@stockpilot/integrations/jupiter-v2";

const wallet = "11111111111111111111111111111111";
const mint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const asset: Asset = {
  id: `prestocks:${mint}`,
  provider: "prestocks",
  name: "SpaceX PreStocks",
  symbol: "SPACEX",
  description: null,
  imageUrl: null,
  externalUrl: null,
  mintAddress: mint,
  tokenPriceUsd: null,
  markPriceUsd: null,
  impliedValuationUsd: null,
  markValuationUsd: null,
  supply: null,
};

function portfolio(usdc = "200"): Portfolio {
  return {
    walletAddress: wallet,
    funding: {
      usdc: { mintAddress: SOLANA_MAINNET_USDC_MINT, amount: usdc, amountUsd: Number(usdc) },
      sol: { amount: "1" },
    },
    portfolioValueUsd: 0,
    positions: [],
    asOf: new Date(0).toISOString(),
  };
}

function order(overrides: Partial<JupiterOrder> = {}): JupiterOrder {
  return {
    requestId: "request-one",
    inputMint: SOLANA_MAINNET_USDC_MINT,
    outputMint: mint,
    inAmount: "50000000",
    outAmount: "125000000",
    taker: wallet,
    router: "metis",
    mode: "ultra",
    feeBps: null,
    feeMint: null,
    priceImpactPct: "0.01",
    transaction: "AQID",
    lastValidBlockHeight: "123",
    expireAt: null,
    ...overrides,
  };
}

function service(options: { asset?: Asset | null; usdc?: string } = {}) {
  const orders: unknown[] = [];
  const jupiter: JupiterExecutionAdapter = {
    async createOrder(input) {
      orders.push(input);
      return order({ inAmount: input.amountRaw });
    },
    async execute() { throw new Error("not used"); },
  };
  return {
    orders,
    value: new InvestmentService(
      { async getAssetBySymbol() { return options.asset === undefined ? asset : options.asset; } },
      { async getPortfolio() { return portfolio(options.usdc); } },
      { async getTokenDecimals() { return 9; } },
      jupiter,
      () => 1_700_000_000_000,
    ),
  };
}

test("parses USDC decimals exactly without floating point arithmetic", () => {
  assert.deepEqual(parseUsdcAmount("1"), { amountUsd: "1", amountRaw: "1000000" });
  assert.deepEqual(parseUsdcAmount("1.500000"), { amountUsd: "1.5", amountRaw: "1500000" });
  assert.deepEqual(parseUsdcAmount("50.25"), { amountUsd: "50.25", amountRaw: "50250000" });
  assert.deepEqual(parseUsdcAmount("0.000001"), { amountUsd: "0.000001", amountRaw: "1" });
});

test("rejects zero, negative, scientific, malformed, over-precision, and u64-overflow amounts", () => {
  for (const value of ["0", "0.000000", "-1", "1e2", "1.0000001", "NaN", " 1", "01", "18446744073710"]) {
    assert.throws(() => parseUsdcAmount(value), (error) => error instanceof InvestmentError && error.code === "INVALID_AMOUNT");
  }
});

test("prepares only canonical USDC to the official server-resolved mint and session wallet", async () => {
  const { value, orders } = service();
  const prepared = await value.prepare({ walletAddress: wallet, symbol: "SPACEX", amountUsd: "50" });
  assert.deepEqual(orders, [{
    inputMint: SOLANA_MAINNET_USDC_MINT,
    outputMint: mint,
    amountRaw: "50000000",
    taker: wallet,
  }]);
  assert.equal(prepared.outputDecimals, 9);
  assert.equal(prepared.outputAmountRaw, "125000000");
  assert.equal(prepared.createdAt, "2023-11-14T22:13:20.000Z");
});

test("rejects missing assets before Jupiter is called", async () => {
  const { value, orders } = service({ asset: null });
  await assert.rejects(
    value.prepare({ walletAddress: wallet, symbol: "UNKNOWN", amountUsd: "1" }),
    (error) => error instanceof InvestmentError && error.code === "ASSET_NOT_FOUND",
  );
  assert.equal(orders.length, 0);
});

test("performs authoritative server-side USDC balance validation", async () => {
  const { value, orders } = service({ usdc: "49.999999" });
  await assert.rejects(
    value.prepare({ walletAddress: wallet, symbol: "SPACEX", amountUsd: "50" }),
    (error) => error instanceof InvestmentError && error.code === "INSUFFICIENT_USDC",
  );
  assert.equal(orders.length, 0);
});

test("a zero balance is reported as insufficient rather than malformed", async () => {
  const { value } = service({ usdc: "0" });
  await assert.rejects(
    value.prepare({ walletAddress: wallet, symbol: "SPACEX", amountUsd: "0.000001" }),
    (error) => error instanceof InvestmentError && error.code === "INSUFFICIENT_USDC",
  );
});
