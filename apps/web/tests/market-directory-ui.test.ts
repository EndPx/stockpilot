import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import { MarketDirectoryRow } from "../components/market-directory-row";
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
    assert.doesNotMatch(html, /PreStocks|xStocks/);
  }
});

test("both asset detail routes use the centered accessible spinner", () => {
  for (const Loading of [PrivateAssetLoading, PublicAssetLoading]) {
    const html = renderToStaticMarkup(createElement(Loading));
    assert.match(html, /market-loading-stage/);
    assert.match(html, /market-loading-spinner/);
    assert.match(html, /Loading asset details/);
  }
});
