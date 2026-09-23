import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import { MarketDirectoryRow } from "../components/market-directory-row";
import { formatMarketPremium, marketPremium } from "../lib/market-premium";
import PrivateAssetLoading from "../app/markets/[symbol]/loading";
import PublicAssetLoading from "../app/markets/xstocks/[mint]/loading";

test("market rows show ticker without repeating provider names", () => {
  const base = {
    canonical: true as const,
    executionStatus: "UNKNOWN" as const,
    name: "Example Inc",
    symbol: "EXMP",
    mintAddress: "11111111111111111111111111111111",
    description: null,
    imageUrl: null,
    tokenPriceUsd: null,
  };
  for (const asset of [
    { ...base, provider: "prestocks" as const, marketType: "PRE_IPO" as const, id: "prestocks:11111111111111111111111111111111" },
    { ...base, provider: "xstocks" as const, marketType: "PUBLIC_MARKET_PRODUCT" as const, id: "xstocks:11111111111111111111111111111111" },
  ] satisfies InvestmentAsset[]) {
    const html = renderToStaticMarkup(createElement(MarketDirectoryRow, { asset }));
    assert.match(html, /EXMP/);
    assert.match(html, /<tr/);
    assert.match(html, /Explore/);
    assert.match(html, /Copy Example Inc Solana address/);
    assert.doesNotMatch(html, /PreStocks|xStocks/);
  }
});

test("Pre-IPO rows show only verified issuer fields and compare token to mark", () => {
  const asset: InvestmentAsset = { canonical: true, executionStatus: "UNKNOWN", id: "prestocks:11111111111111111111111111111111", provider: "prestocks", marketType: "PRE_IPO", name: "Example Inc", symbol: "EXMP", mintAddress: "11111111111111111111111111111111", imageUrl: null, description: null, tokenPriceUsd: 1293.05, markPriceUsd: 1020.54, impliedValuationUsd: 1_600_000_000_000, markValuationUsd: 1_260_000_000_000, externalUrl: "https://example.com/product" };
  const html = renderToStaticMarkup(createElement(MarketDirectoryRow, { asset }));
  assert.match(html, /\$1,293\.05/);
  assert.match(html, /\$1,020\.54/);
  assert.match(html, /\+26\.7% premium/);
  assert.match(html, /\$1\.6T/);
  assert.match(html, /Information/);
  assert.match(html, /https:\/\/example\.com\/product/);
  assert.equal(formatMarketPremium(marketPremium(1030.23, 1050.84)), "-2.0%");
  assert.equal(marketPremium(null, 100), null);
  assert.equal(marketPremium(100, 0), null);
});

test("catalog rows do not repeat issuer suffixes in product names", () => {
  const asset: InvestmentAsset = { canonical: true, executionStatus: "UNKNOWN", id: "prestocks:11111111111111111111111111111111", provider: "prestocks", marketType: "PRE_IPO", name: "Polymarket PreStocks", symbol: "POLYMARKET", mintAddress: "11111111111111111111111111111111", imageUrl: null, description: null, tokenPriceUsd: null };
  const html = renderToStaticMarkup(createElement(MarketDirectoryRow, { asset }));
  assert.match(html, /<strong>Polymarket<\/strong>/);
  assert.doesNotMatch(html, /Polymarket PreStocks/);
});

test("both asset detail routes use the centered accessible spinner", () => {
  for (const Loading of [PrivateAssetLoading, PublicAssetLoading]) {
    const html = renderToStaticMarkup(createElement(Loading));
    assert.match(html, /market-loading-stage/);
    assert.match(html, /market-loading-spinner/);
    assert.match(html, /Loading asset details/);
  }
});
