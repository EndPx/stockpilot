import assert from "node:assert/strict";
import test from "node:test";
import type { InvestmentAsset } from "@stockpilot/core/asset-registry";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import type { InvestmentAuthorization } from "../lib/investments/authorization";
import { InvestmentApiError } from "../lib/investments/errors";
import { assertCurrentInvestorEligibility, assertFreshPreStocksSymbolInSnapshot, assertFreshTradeAssetInSnapshot } from "../lib/investments/trade-asset";

const now = 1_700_000_000_000;
const mint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const wallet = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";

function authorization(overrides: Partial<InvestmentAuthorization> = {}): InvestmentAuthorization {
  return {
    kind: "investment", side: "BUY", provider: "prestocks", walletAddress: wallet,
    requestId: "quote-one", inputMint: SOLANA_MAINNET_USDC_MINT,
    outputMint: mint, inputAmountRaw: "1000000", requiredMinimumOutputRaw: "1",
    maximumWalletNativeDebitLamportsRaw: "300000", outputDecimals: 9,
    inputDecimals: 6, symbol: "SPACEX", messageFingerprint: "a".repeat(43),
    lastValidBlockHeight: "1", orderExpireAt: null, createdAt: now,
    expiresAt: now + 120_000, ...overrides,
  };
}

function asset(overrides: Partial<InvestmentAsset> = {}): InvestmentAsset {
  return {
    id: `prestocks:${mint}`, provider: "prestocks", marketType: "PRE_IPO",
    canonical: true, executionStatus: "UNKNOWN", mintAddress: mint,
    name: "SpaceX PreStocks", symbol: "SPACEX", description: null,
    imageUrl: null, tokenPriceUsd: null,
    availability: { status: "AVAILABLE", reason: null, issuerTermsUrl: null,
      restrictedJurisdictions: [], restrictionsComplete: true,
      reviewedAt: new Date(now - 1_000).toISOString() },
    ...overrides,
  } as InvestmentAsset;
}

function snapshot(overrides: Partial<{
  assets: InvestmentAsset[];
  sources: { provider: "prestocks" | "xstocks"; fetchedAt: string; stale: boolean }[];
  stale: boolean;
}> = {}) {
  return {
    assets: [asset()],
    sources: [{ provider: "prestocks" as const, fetchedAt: new Date(now - 1_000).toISOString(), stale: false }],
    stale: false,
    ...overrides,
  };
}

function rejects(code: "ASSET_CATALOG_STALE" | "ASSET_NOT_ALLOWED", action: () => void): void {
  assert.throws(action, (error: unknown) =>
    error instanceof InvestmentApiError && error.code === code);
}

test("execute-time catalog identity accepts only the exact, current reviewed issuer mint", () => {
  assert.doesNotThrow(() => assertFreshTradeAssetInSnapshot(authorization(), snapshot(), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [] }), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [asset({ symbol: "SPACEX2" })] }), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [asset({ mintAddress: wallet })] }), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [asset(), asset()] }), now));
});

test("pre-quote symbol review fails closed for unknown, duplicate and unreviewed issuer rows", () => {
  assert.equal(assertFreshPreStocksSymbolInSnapshot("spacex", snapshot(), now), mint);
  rejects("ASSET_NOT_ALLOWED", () => assertFreshPreStocksSymbolInSnapshot("SPACEX", snapshot({ assets: [asset(), asset()] }), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshPreStocksSymbolInSnapshot("SPACEX", snapshot({ assets: [asset({ availability: undefined })] }), now));
  rejects("ASSET_CATALOG_STALE", () => assertFreshPreStocksSymbolInSnapshot("SPACEX", snapshot({ stale: true }), now));
  assert.throws(() => assertFreshPreStocksSymbolInSnapshot("UNKNOWN", snapshot(), now),
    (error: unknown) => error instanceof InvestmentApiError && error.code === "ASSET_NOT_FOUND");
});

test("stale or absent issuer provenance rejects before submission", () => {
  rejects("ASSET_CATALOG_STALE", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ stale: true }), now));
  rejects("ASSET_CATALOG_STALE", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ sources: [] }), now));
  rejects("ASSET_CATALOG_STALE", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({
    sources: [{ provider: "prestocks", fetchedAt: new Date(now - 45_000).toISOString(), stale: false }],
  }), now));
  rejects("ASSET_CATALOG_STALE", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({
    sources: [{ provider: "prestocks", fetchedAt: new Date(now + 6_000).toISOString(), stale: false }],
  }), now));
});

test("revoked, unknown or expired availability is never treated as trade permission", () => {
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [asset({ availability: undefined })] }), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [asset({
    availability: { ...asset().availability!, status: "RESTRICTED" },
  })] }), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [asset({
    availability: { ...asset().availability!, restrictionsComplete: false },
  })] }), now));
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization(), snapshot({ assets: [asset({
    availability: { ...asset().availability!, reviewedAt: new Date(now - 24 * 60 * 60_000).toISOString() },
  })] }), now));
});

test("SELL binds the sold asset and xStocks additionally require an explicit unhalted issuer state", () => {
  const sell = authorization({ side: "SELL", inputMint: mint,
    outputMint: SOLANA_MAINNET_USDC_MINT, inputDecimals: 9, outputDecimals: 6 });
  assert.doesNotThrow(() => assertFreshTradeAssetInSnapshot(sell, snapshot(), now));
  const xstock = asset({ id: `xstocks:${mint}`, provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT",
    metadata: { issuerId: "issuer", sourceUrl: "https://example.test", classificationSource: null,
      underlyingSymbol: null, underlyingIsin: null, productIsin: null, isTradingHalted: true } });
  const xstockSnapshot = snapshot({ assets: [xstock], sources: [{ provider: "xstocks", fetchedAt: new Date(now).toISOString(), stale: false }] });
  rejects("ASSET_NOT_ALLOWED", () => assertFreshTradeAssetInSnapshot(authorization({ provider: "xstocks" }), xstockSnapshot, now));
  assert.doesNotThrow(() => assertFreshTradeAssetInSnapshot(authorization({ provider: "xstocks" }), {
    ...xstockSnapshot, assets: [{ ...xstock, metadata: { ...xstock.metadata!, isTradingHalted: false } }],
  }, now));
});

test("server-owned investor review is missing and production default always denies", async () => {
  await assert.rejects(assertCurrentInvestorEligibility({ accountId: "did:privy:owner", walletAddress: wallet,
    provider: "prestocks", side: "BUY", mintAddress: mint }),
  (error: unknown) => error instanceof InvestmentApiError && error.code === "ASSET_NOT_ALLOWED" && error.status === 403);
});
