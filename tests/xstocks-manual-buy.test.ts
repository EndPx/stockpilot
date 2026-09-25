import assert from "node:assert/strict";
import test from "node:test";
import { InvestmentAssetRegistry } from "@stockpilot/core/asset-registry";
import type { EligibilityResult } from "@stockpilot/core/execution-eligibility";
import type { Portfolio } from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_MINT, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import {
  XStocksManualBuyService,
  XStocksBuyError,
  type InvestorEligibilityReview,
  type XStocksBuyErrorCode,
  type XStocksBuyPolicy,
} from "@stockpilot/core/xstocks-manual-buy";
import { normalizeXStock } from "@stockpilot/integrations/xstocks";
import type { JupiterOrder } from "@stockpilot/integrations/jupiter-v2";

const now = Date.parse("2026-09-25T00:00:00Z");
const mint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const wallet = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const principalId = "did:privy:fixture-user";
const asset = normalizeXStock({
  id: "9e43a778-fdc8-44f1-87de-f2e7420bb7f7", name: "Apple", symbol: "AAPLx",
  isTradingHalted: false, isin: "CH1436219187", underlying: { isin: "US0378331005" },
  deployments: [{ network: "Solana", address: mint }],
});
const policy: XStocksBuyPolicy = {
  maxFeeBps: 50, maxPriceImpactBps: 200, maxSlippageBps: 100,
  maxProductReviewAgeMs: 86_400_000, maxOrderLifetimeMs: 120_000,
};
const order: JupiterOrder = {
  requestId: "fixture-order", inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mint,
  inAmount: "50000000", outAmount: "125000000", taker: wallet,
  router: "fixture", mode: "ultra", feeBps: 10, feeMint: SOLANA_MAINNET_USDC_MINT,
  priceImpactPct: "0.01", transaction: "AQID", lastValidBlockHeight: "100", expireAt: new Date(now + 60_000).toISOString(),
};
const review: InvestorEligibilityReview = {
  principalId, walletAddress: wallet, assetId: asset.id, mintAddress: mint,
  allowed: true, restrictionsComplete: true, evidenceId: "eligibility-fixture",
  reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(),
};
const technical: EligibilityResult = {
  assetId: asset.id, status: "EXECUTABLE", reason: "TECHNICAL_CHECKS_PASSED",
  validatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(),
  findings: {
    mint: { mint, program: TOKEN_2022_PROGRAM_ADDRESS, decimals: 8, supplyRaw: "100000000", mintAuthority: null, freezeAuthority: null, extensions: [] },
    quote: { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mint, inputRaw: "1000000", outputRaw: "291895", venues: ["fixture"] },
    blockers: [],
  },
};

function setup(options: {
  product?: typeof asset;
  stale?: boolean;
  validation?: EligibilityResult;
  investor?: InvestorEligibilityReview | null;
  portfolio?: Portfolio;
  order?: JupiterOrder;
  missingVerifier?: boolean;
  unsigned?: boolean;
  unsignedError?: Error;
} = {}) {
  let orderCalls = 0;
  const identityCalls: string[] = [];
  const product = structuredClone(options.product ?? asset);
  const registry = new InvestmentAssetRegistry([{ provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT", getSnapshot: async () => ({ assets: [product], fetchedAt: new Date(now).toISOString(), stale: options.stale ?? false }) }]);
  const portfolio: Portfolio = options.portfolio ?? {
    walletAddress: wallet,
    funding: { usdc: { mintAddress: SOLANA_MAINNET_USDC_MINT, amount: "100", amountUsd: 100 }, sol: { amount: "1" } },
    portfolioValueUsd: 0, positions: [], asOf: new Date(now).toISOString(),
  };
  const verifier = async (_transaction: string, address: string) => {
    identityCalls.push(`unsigned:${address}`);
    if (options.unsignedError) throw options.unsignedError;
    return options.unsigned ?? true;
  };
  const service = new XStocksManualBuyService(
    { principalId, walletAddress: wallet },
    registry,
    { validateForExecution: async () => options.validation ?? structuredClone(technical) },
    { getPortfolio: async (address) => { identityCalls.push(`portfolio:${address}`); return portfolio; } },
    { createOrder: async ({ taker }) => { identityCalls.push(`order:${taker}`); orderCalls++; return options.order ?? structuredClone(order); } },
    async ({ principalId: id, walletAddress: address }) => {
      identityCalls.push(`review:${id}:${address}`);
      return options.investor === undefined ? review : options.investor;
    },
    options.missingVerifier ? undefined as unknown as typeof verifier : verifier,
    policy,
    () => now,
  );
  return { service, orderCalls: () => orderCalls, identityCalls };
}

function approvedProduct() {
  return {
    ...structuredClone(asset),
    availability: { ...asset.availability!, status: "AVAILABLE" as const, restrictionsComplete: true, reviewedAt: new Date(now).toISOString() },
  };
}

const request = { assetId: asset.id, amountUsd: "50" };
async function rejects(code: XStocksBuyErrorCode, fixture = setup(), input = request) {
  await assert.rejects(fixture.service.prepare(input), (error) => error instanceof XStocksBuyError && error.code === code);
  assert.equal(fixture.orderCalls(), 0);
}

test("today's official discovery rows are not purchasable without a product review", async () => {
  await rejects("PRODUCT_REVIEW_REQUIRED");
});

test("the prepared order cannot outlive the product review", async () => {
  const expiringProduct = approvedProduct();
  expiringProduct.availability!.reviewedAt = new Date(now - policy.maxProductReviewAgeMs + 1_000).toISOString();
  const result = await setup({ product: expiringProduct }).service.prepare(request);
  assert.equal(result.expiresAt, new Date(now + 1_000).toISOString());
});

test("a reviewed fixture can prepare only a raw-unit order requiring later instruction validation", async () => {
  const fixture = setup({ product: approvedProduct() });
  const result = await fixture.service.prepare(request);
  assert.equal(fixture.orderCalls(), 1);
  assert.equal(result.assetId, `xstocks:${mint}`);
  assert.equal(result.principalId, principalId);
  assert.equal(result.walletAddress, wallet);
  assert.equal(result.inputMint, SOLANA_MAINNET_USDC_MINT);
  assert.equal(result.outputMint, mint);
  assert.equal(result.inputRaw, "50000000");
  assert.equal(result.quotedOutputRaw, "125000000");
  assert.equal(result.requiredMinimumOutputRaw, "123750000");
  assert.equal(result.outputDecimals, 8);
  assert.equal(result.outputUnits, "RAW_TOKEN_2022_BASE_UNITS");
  assert.equal(result.transactionStatus, "REQUIRES_INSTRUCTION_VALIDATION");
  assert.equal(result.expiresAt, technical.expiresAt);
  assert.deepEqual(fixture.identityCalls, [
    `review:${principalId}:${wallet}`, `portfolio:${wallet}`, `order:${wallet}`, `unsigned:${wallet}`,
  ]);
});

test("trade arguments cannot override the server-bound principal or wallet", async () => {
  const fixture = setup({ product: approvedProduct() });
  const forged = { ...request, principalId: "did:privy:other", sessionWalletAddress: mint } as unknown as typeof request;
  await assert.rejects(fixture.service.prepare(forged),
    (error) => error instanceof XStocksBuyError && error.code === "INVALID_INPUT");
  assert.equal(fixture.orderCalls(), 0);
  assert.deepEqual(fixture.identityCalls, []);
});

test("unverified, false, or failing unsigned-envelope proof blocks prepared BUY", async () => {
  assert.throws(() => setup({ product: approvedProduct(), missingVerifier: true }),
    (error) => error instanceof XStocksBuyError && error.code === "UNSIGNED_ENVELOPE_UNVERIFIED");
  for (const options of [{ unsigned: false }, { unsignedError: new Error("parse failure") }]) {
    const fixture = setup({ product: approvedProduct(), ...options });
    await assert.rejects(fixture.service.prepare(request),
      (error) => error instanceof XStocksBuyError && error.code === "UNSIGNED_ENVELOPE_UNVERIFIED");
    assert.equal(fixture.orderCalls(), 1);
    assert.equal(fixture.identityCalls.at(-1), `unsigned:${wallet}`);
  }
});

test("forged ticker, missing asset and stale catalog fail before quote/order", async () => {
  await rejects("INVALID_INPUT", setup({ product: approvedProduct() }), { ...request, assetId: "AAPLx" });
  await rejects("ASSET_NOT_ALLOWED", setup({ product: approvedProduct() }), { ...request, assetId: `xstocks:${wallet}` });
  await rejects("CATALOG_UNAVAILABLE", setup({ product: approvedProduct(), stale: true }));
});

test("generic classification, issuer halt and incomplete terms block BUY", async () => {
  const generic = approvedProduct(); generic.marketType = "PUBLIC_MARKET_PRODUCT"; generic.metadata!.classificationSource = null;
  await rejects("ASSET_NOT_ALLOWED", setup({ product: generic }));
  const halted = approvedProduct(); halted.metadata!.isTradingHalted = true;
  await rejects("ASSET_NOT_ALLOWED", setup({ product: halted }));
  const terms = approvedProduct(); terms.availability!.restrictionsComplete = false;
  await rejects("PRODUCT_REVIEW_REQUIRED", setup({ product: terms }));
});

test("technical status must match the canonical Token-2022 mint and live diagnostic pair", async () => {
  const unavailable = structuredClone(technical); unavailable.status = "UNAVAILABLE";
  await rejects("TECHNICAL_REVIEW_REQUIRED", setup({ product: approvedProduct(), validation: unavailable }));
  const wrongProgram = structuredClone(technical); wrongProgram.findings.mint!.program = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  await rejects("TECHNICAL_REVIEW_REQUIRED", setup({ product: approvedProduct(), validation: wrongProgram }));
  const wrongQuote = structuredClone(technical); wrongQuote.findings.quote!.outputMint = wallet;
  await rejects("TECHNICAL_REVIEW_REQUIRED", setup({ product: approvedProduct(), validation: wrongQuote }));
  const expired = structuredClone(technical); expired.expiresAt = new Date(now).toISOString();
  await rejects("TECHNICAL_REVIEW_REQUIRED", setup({ product: approvedProduct(), validation: expired }));
});

test("investor review is person-, wallet-, asset- and time-bound", async () => {
  await rejects("INVESTOR_REVIEW_REQUIRED", setup({ product: approvedProduct(), investor: null }));
  await rejects("INVESTOR_REVIEW_REQUIRED", setup({ product: approvedProduct(), investor: { ...review, walletAddress: mint } }));
  await rejects("INVESTOR_REVIEW_REQUIRED", setup({ product: approvedProduct(), investor: { ...review, principalId: "another-user" } }));
  await rejects("INVESTOR_REVIEW_REQUIRED", setup({ product: approvedProduct(), investor: { ...review, expiresAt: new Date(now).toISOString() } }));
});

test("wallet balance must use canonical mainnet USDC and cover the exact raw spend", async () => {
  const base = setup({ product: approvedProduct() });
  const low: Portfolio = { walletAddress: wallet, funding: { usdc: { mintAddress: SOLANA_MAINNET_USDC_MINT, amount: "49.999999", amountUsd: 49.999999 }, sol: { amount: "1" } }, positions: [], portfolioValueUsd: 0, asOf: new Date(now).toISOString() };
  await rejects("INSUFFICIENT_USDC", setup({ product: approvedProduct(), portfolio: low }));
  const wrong = structuredClone(low); wrong.funding.usdc.mintAddress = mint;
  await rejects("INSUFFICIENT_USDC", setup({ product: approvedProduct(), portfolio: wrong }));
  assert.equal(base.orderCalls(), 0);
});

test("order identity, fee, impact, transaction and expiry remain fail-closed", async () => {
  for (const change of [
    { outputMint: wallet }, { inAmount: "50000001" }, { taker: mint },
    { transaction: "not-base64!" }, { expireAt: null }, { lastValidBlockHeight: null },
  ]) {
    const fixture = setup({ product: approvedProduct(), order: { ...order, ...change } });
    await assert.rejects(fixture.service.prepare(request), (error) => error instanceof XStocksBuyError && error.code === "ORDER_UNAVAILABLE");
    assert.equal(fixture.orderCalls(), 1);
  }
  for (const change of [{ feeBps: 51 }, { feeMint: wallet }, { priceImpactPct: "2.01" }, { priceImpactPct: null }]) {
    const fixture = setup({ product: approvedProduct(), order: { ...order, ...change } });
    await assert.rejects(fixture.service.prepare(request), (error) => error instanceof XStocksBuyError && error.code === "ORDER_OUT_OF_POLICY");
  }
});
