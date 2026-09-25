import assert from "node:assert/strict";
import test from "node:test";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PortfolioErrorState,
  PortfolioInvestments,
  PortfolioLoading,
  PortfolioSummary,
  PortfolioView,
} from "../components/portfolio-overview";

function portfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    walletAddress: "11111111111111111111111111111111",
    funding: {
      usdc: {
        mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "200",
        amountUsd: 200,
      },
      sol: { amount: "0.42" },
    },
    portfolioValueUsd: 0,
    positions: [],
    asOf: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

test("USDC-positive empty investments presents available capital, not an unusable wallet", () => {
  const html = renderToStaticMarkup(createElement(PortfolioView, { portfolio: portfolio() }));
  assert.match(html, /Available to Invest/);
  assert.match(html, /\$200\.00/);
  assert.match(html, /No canonical Stocks or Pre-IPO holdings found/);
  assert.match(html, /You&#x27;re ready to invest/);
  assert.match(html, /Explore Markets/);
  assert.doesNotMatch(html, /No portfolio/);
});

test("zero USDC empty state is distinct from the funded empty state", () => {
  const value = portfolio({
    funding: {
      usdc: { mintAddress: portfolio().funding.usdc.mintAddress, amount: "0", amountUsd: 0 },
      sol: { amount: "0" },
    },
  });
  const html = renderToStaticMarkup(createElement(PortfolioView, { portfolio: value }));
  assert.match(html, /Add USDC to this wallet/);
  assert.doesNotMatch(html, /You&#x27;re ready to invest/);
});

test("investment position links to its existing Market detail and labels estimates", () => {
  const value = portfolio({
    portfolioValueUsd: null,
    positions: [{
      provider: "prestocks",
      name: "SpaceX PreStocks",
      symbol: "SPACEX",
      mintAddress: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
      quantity: "0.4",
      tokenPriceUsd: null,
      estimatedValueUsd: null,
      imageUrl: null,
    }],
  });
  const html = renderToStaticMarkup(createElement(PortfolioView, { portfolio: value }));
  assert.match(html, /href="\/markets\/SPACEX"/);
  assert.match(html, /0\.4 SPACEX/);
  assert.match(html, /Estimated Value/);
  assert.match(html, /not executable liquidation quotes/);
  assert.doesNotMatch(html, /Buy|Sell|Swap|Profit|Loss/);
});

test("xStocks holdings link to the canonical mint detail without inventing a display quantity", () => {
  const mintAddress = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
  const html = renderToStaticMarkup(createElement(PortfolioInvestments, { portfolio: portfolio({
    portfolioValueUsd: null,
    positions: [{ provider: "xstocks", name: "Example xStock", symbol: "EXx", mintAddress,
      quantity: null, rawTokenAmount: "1000000", decimals: 6, displayStatus: "MULTIPLIER_UNVERIFIED",
      tokenPriceUsd: 12, estimatedValueUsd: null, imageUrl: null }],
  }) }));
  assert.match(html, new RegExp(`href="/markets/xstocks/${mintAddress}"`));
  assert.match(html, /display quantity unavailable/);
  assert.doesNotMatch(html, /href="\/markets\/EXx"/);
});

test("wallet can render balances and investments independently from the overview summary", () => {
  const value = portfolio({
    positions: [{
      provider: "prestocks",
      name: "SpaceX PreStocks",
      symbol: "SPACEX",
      mintAddress: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
      quantity: "0.4",
      tokenPriceUsd: 100,
      estimatedValueUsd: 40,
      imageUrl: null,
    }],
  });
  const summary = renderToStaticMarkup(createElement(PortfolioSummary, { portfolio: value }));
  const investments = renderToStaticMarkup(createElement(PortfolioInvestments, { portfolio: value }));
  assert.match(summary, /Portfolio Estimate|Available to Invest|Network Balance/);
  assert.doesNotMatch(summary, /Investments|SPACEX/);
  assert.match(investments, /Investments|SPACEX|Estimated Value/);
  assert.doesNotMatch(investments, /Network Balance/);
});

test("loading layout is intentional and error states preserve failure semantics", () => {
  const loading = renderToStaticMarkup(createElement(PortfolioLoading));
  assert.match(loading, /Loading portfolio/);
  assert.match(loading, /Available to Invest/);

  const rpc = renderToStaticMarkup(createElement(PortfolioErrorState, {
    code: "SOLANA_RPC_UNAVAILABLE",
    onRetry() {},
    onSignIn() {},
  }));
  assert.match(rpc, /couldn&#x27;t load your wallet balances/);
  assert.match(rpc, /not been replaced with zeros/);

  const expired = renderToStaticMarkup(createElement(PortfolioErrorState, {
    code: "UNAUTHENTICATED",
    onRetry() {},
    onSignIn() {},
  }));
  assert.match(expired, /session has expired/);
  assert.match(expired, /Sign In Again/);
});
