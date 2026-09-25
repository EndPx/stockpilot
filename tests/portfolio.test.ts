import assert from "node:assert/strict";
import test from "node:test";
import { type Asset } from "@stockpilot/core/assets";
import type { InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import {
  formatRawTokenAmount,
  PortfolioService,
  type SolanaReadAdapter,
  type TokenBalance,
} from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";

const spacexMint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const openaiMint = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const unrelatedMint = "So11111111111111111111111111111111111111112";

const assets: Asset[] = [
  {
    id: `prestocks:${spacexMint}`,
    provider: "prestocks",
    canonical: true, executionStatus: "UNKNOWN",
    marketType: "PRE_IPO",
    name: "SpaceX PreStocks",
    symbol: "SPACEX",
    description: null,
    imageUrl: "https://example.com/spacex.png",
    externalUrl: null,
    mintAddress: spacexMint,
    tokenPriceUsd: 123,
    markPriceUsd: null,
    impliedValuationUsd: null,
    markValuationUsd: null,
    supply: null,
  },
  {
    id: `prestocks:${openaiMint}`,
    provider: "prestocks",
    canonical: true, executionStatus: "UNKNOWN",
    marketType: "PRE_IPO",
    name: "OpenAI PreStocks",
    symbol: "OPENAI",
    description: null,
    imageUrl: null,
    externalUrl: null,
    mintAddress: openaiMint,
    tokenPriceUsd: null,
    markPriceUsd: null,
    impliedValuationUsd: null,
    markValuationUsd: null,
    supply: null,
  },
];

function token(
  mintAddress: string,
  rawAmount: string,
  decimals: number,
  program: TokenBalance["program"] = "token-2022",
): TokenBalance {
  return {
    mintAddress,
    rawAmount,
    decimals,
    amount: formatRawTokenAmount(rawAmount, decimals),
    program,
  };
}

function createService(
  tokenBalances: TokenBalance[],
  options: { assets?: InvestmentAsset[]; assetError?: Error; rpcError?: Error;
    prices?: Map<string, number | null>; priceError?: Error; catalogStale?: boolean } = {},
) {
  const calls: string[] = [];
  const assetReader = {
    async getSnapshot() {
      if (options.assetError) throw options.assetError;
      return { assets: options.assets ?? assets, fetchedAt: new Date(0).toISOString(), stale: options.catalogStale ?? false };
    },
    async getHeldIndicativePrices(held: readonly InvestmentAsset[]) {
      if (options.priceError) throw options.priceError;
      return new Map(held.flatMap((asset) => options.prices?.has(asset.mintAddress)
        ? [[asset.mintAddress, { quote: options.prices.get(asset.mintAddress)!,
          fetchedAt: "2023-11-14T22:13:20.000Z", stale: false }] as const] : []));
    },
  };
  const solana: SolanaReadAdapter = {
    async getNativeBalance(walletAddress) {
      calls.push(`sol:${walletAddress}`);
      if (options.rpcError) throw options.rpcError;
      return { rawLamports: "420000000", amount: "0.42" };
    },
    async getTokenBalances(walletAddress) {
      calls.push(`tokens:${walletAddress}`);
      if (options.rpcError) throw options.rpcError;
      return tokenBalances;
    },
  };
  return { service: new PortfolioService(assetReader, solana, () => 1_700_000_000_000), calls };
}

test("formats raw u64-sized amounts and decimals without Number precision loss", () => {
  assert.equal(formatRawTokenAmount("18446744073709551615", 9), "18446744073.709551615");
  assert.equal(formatRawTokenAmount("1000000", 6), "1");
  assert.equal(formatRawTokenAmount("1005000", 6), "1.005");
  assert.throws(() => formatRawTokenAmount("1.2", 6), /invalid raw amount/);
});

test("returns zero funding and zero positions for a wallet with no token accounts", async () => {
  const { service } = createService([]);
  const portfolio = await service.getPortfolio("wallet-one");
  assert.equal(portfolio.funding.usdc.amount, "0");
  assert.equal(portfolio.funding.usdc.amountUsd, 0);
  assert.equal(portfolio.funding.sol.amount, "0.42");
  assert.equal(portfolio.portfolioValueUsd, 0);
  assert.deepEqual(portfolio.positions, []);
});

test("detects canonical legacy USDC independently from Token-2022 positions", async () => {
  const { service } = createService([
    token(SOLANA_MAINNET_USDC_MINT, "200000000", 6, "spl-token"),
    token(spacexMint, "400000000", 9),
  ]);
  const portfolio = await service.getPortfolio("wallet-two");
  assert.equal(portfolio.funding.usdc.amount, "200");
  assert.equal(portfolio.funding.usdc.amountUsd, 200);
  assert.equal(portfolio.positions[0].quantity, "0.4");
  assert.equal(portfolio.positions[0].estimatedValueUsd, 49.2);
  assert.equal(portfolio.portfolioValueUsd, 49.2);
});

test("aggregates multiple accounts for one official mint with bigint arithmetic", async () => {
  const { service } = createService([
    token(spacexMint, "9007199254740993", 9),
    token(spacexMint, "7", 9),
  ]);
  const portfolio = await service.getPortfolio("wallet-three");
  assert.equal(portfolio.positions[0].quantity, "9007199.254741");
});

test("returns multiple official positions and excludes unrelated SPL tokens", async () => {
  const { service } = createService([
    token(spacexMint, "1", 0),
    token(openaiMint, "30", 3),
    token(unrelatedMint, "999000000", 6, "spl-token"),
  ]);
  const portfolio = await service.getPortfolio("wallet-four");
  assert.deepEqual(portfolio.positions.map(({ symbol }) => symbol), ["SPACEX", "OPENAI"]);
  assert.equal(portfolio.positions[1].quantity, "0.03");
  assert.equal(portfolio.positions[1].estimatedValueUsd, null);
  assert.equal(portfolio.portfolioValueUsd, null);
  assert.equal(portfolio.unrecognizedTokenMintCount, 1);
});

test("getBalance reads confirmed SOL and canonical USDC without an issuer catalog", async () => {
  const { service, calls } = createService([
    token(SOLANA_MAINNET_USDC_MINT, "12500000", 6, "spl-token"),
  ], { assetError: new Error("both issuer catalogs unavailable") });
  const balance = await service.getBalance("session-wallet");
  assert.equal(balance.walletAddress, "session-wallet");
  assert.equal(balance.funding.usdc.amount, "12.5");
  assert.equal(balance.funding.sol.amount, "0.42");
  assert.equal(balance.source, "solana_rpc");
  assert.equal(balance.commitment, "confirmed");
  assert.deepEqual(calls.sort(), ["sol:session-wallet", "tokens:session-wallet"]);
});

test("getBalance rejects RPC failure and contradictory canonical USDC decimals", async () => {
  const unavailable = createService([], { rpcError: new Error("rpc unavailable") });
  await assert.rejects(unavailable.service.getBalance("session-wallet"), /rpc unavailable/);
  const malformed = createService([token(SOLANA_MAINNET_USDC_MINT, "100", 9)]);
  await assert.rejects(malformed.service.getBalance("session-wallet"), /unexpected decimals/);
});

test("canonical xStocks holding is reported from on-chain raw amount but never valued without Scaled UI multiplier", async () => {
  const stock: InvestmentAsset = {
    id: `xstocks:${unrelatedMint}`, provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT",
    canonical: true, executionStatus: "UNKNOWN", mintAddress: unrelatedMint,
    name: "Example xStock", symbol: "EXx", description: null, imageUrl: null,
    tokenPriceUsd: null,
  };
  const { service } = createService([
    token(spacexMint, "1000000000", 9),
    token(unrelatedMint, "2500000000", 9),
  ], { assets: [...assets, stock], prices: new Map([[unrelatedMint, 200]]) });
  const portfolio = await service.getPortfolio("session-wallet");
  assert.deepEqual(portfolio.positions.map(({ provider }) => provider), ["prestocks", "xstocks"]);
  const xstock = portfolio.positions[1];
  assert.equal(xstock.rawTokenAmount, "2500000000");
  assert.equal(xstock.decimals, 9);
  assert.equal(xstock.quantity, null);
  assert.equal(xstock.displayStatus, "MULTIPLIER_UNVERIFIED");
  assert.equal(xstock.tokenPriceUsd, 200);
  assert.equal(xstock.priceSource, "xstocks_issuer");
  assert.equal(xstock.priceStale, false);
  assert.equal(xstock.estimatedValueUsd, null);
  assert.equal(portfolio.portfolioValueUsd, null);
  assert.equal(portfolio.valuationScope, "INVESTMENT_POSITIONS_ONLY");
  assert.equal(portfolio.unrecognizedTokenMintCount, 0);
});

test("issuer quote failure leaves xStocks unvalued without hiding verified token holdings", async () => {
  const stock: InvestmentAsset = {
    id: `xstocks:${unrelatedMint}`, provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT",
    canonical: true, executionStatus: "UNKNOWN", mintAddress: unrelatedMint,
    name: "Example xStock", symbol: "EXx", description: null, imageUrl: null,
    tokenPriceUsd: null,
  };
  const { service } = createService([token(unrelatedMint, "1", 9)], {
    assets: [stock], priceError: new Error("price provider down"),
  });
  const portfolio = await service.getPortfolio("session-wallet");
  assert.equal(portfolio.positions[0].rawTokenAmount, "1");
  assert.equal(portfolio.positions[0].tokenPriceUsd, null);
  assert.equal(portfolio.positions[0].priceSource, null);
  assert.equal(portfolio.positions[0].priceStale, true);
  assert.equal(portfolio.positions[0].estimatedValueUsd, null);
  assert.equal(portfolio.portfolioValueUsd, null);
});

test("fresh issuer quote does not conceal a stale canonical catalog", async () => {
  const stock: InvestmentAsset = {
    id: `xstocks:${unrelatedMint}`, provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT",
    canonical: true, executionStatus: "UNKNOWN", mintAddress: unrelatedMint,
    name: "Example xStock", symbol: "EXx", description: null, imageUrl: null,
    tokenPriceUsd: null,
  };
  const { service } = createService([token(unrelatedMint, "10", 9)], {
    assets: [stock], prices: new Map([[unrelatedMint, 200]]), catalogStale: true,
  });
  const portfolio = await service.getPortfolio("session-wallet");
  assert.equal(portfolio.positions[0].priceSource, "xstocks_issuer");
  assert.equal(portfolio.positions[0].priceStale, true);
  assert.equal(portfolio.positions[0].estimatedValueUsd, null);
});

test("does not list zero-balance official positions", async () => {
  const { service } = createService([token(spacexMint, "0", 9)]);
  assert.deepEqual((await service.getPortfolio("wallet-five")).positions, []);
});

test("uses exactly the wallet passed to the service for both RPC reads", async () => {
  const { service, calls } = createService([]);
  const portfolio = await service.getPortfolio("verified-session-wallet");
  assert.equal(portfolio.walletAddress, "verified-session-wallet");
  assert.deepEqual(calls.sort(), ["sol:verified-session-wallet", "tokens:verified-session-wallet"]);
});

test("RPC failure rejects instead of returning an empty portfolio", async () => {
  const { service } = createService([], { rpcError: new Error("rpc unavailable") });
  await assert.rejects(service.getPortfolio("wallet-six"), /rpc unavailable/);
});

test("PreStocks failure rejects instead of returning an empty portfolio", async () => {
  const { service } = createService([], { assetError: new Error("provider unavailable") });
  await assert.rejects(service.getPortfolio("wallet-seven"), /provider unavailable/);
});

test("rejects contradictory decimals and malformed native balance data", async () => {
  const { service } = createService([
    token(spacexMint, "1", 6),
    token(spacexMint, "1", 9),
  ]);
  await assert.rejects(service.getPortfolio("wallet-eight"), /disagree on decimals/);

  const brokenSolana: SolanaReadAdapter = {
    async getNativeBalance() { return { rawLamports: "1", amount: "2" }; },
    async getTokenBalances() { return []; },
  };
  const assetReader = { async getSnapshot() { return { assets: [], fetchedAt: new Date(0).toISOString(), stale: false }; } };
  await assert.rejects(new PortfolioService(assetReader, brokenSolana).getPortfolio("wallet-nine"), /does not match/);
});
