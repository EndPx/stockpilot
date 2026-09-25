import assert from "node:assert/strict";
import test from "node:test";
import type { InvestmentAsset } from "@stockpilot/integrations/asset-domain";
import type { MintInspection } from "@stockpilot/integrations/market-validation";
import type { JupiterOrder } from "@stockpilot/integrations/jupiter-v2";
import type { TokenBalance } from "@stockpilot/core/portfolio";
import { SOLANA_MAINNET_USDC_MINT, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";
import { fetchJupiterReverseSellQuote, ManualSellError, ManualSellService, type ManualSellErrorCode,
  type ProductSellReview, type InvestorSellReview, type OwnerTokenSellReview,
  type ReverseSellQuote, type SellPolicy } from "@stockpilot/core/manual-sell";

const now = Date.parse("2026-09-25T00:00:00Z");
const wallet = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const mint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const principal = { principalId: "did:privy:sell-owner", walletAddress: wallet };
const policy: SellPolicy = { maxFeeBps: 50, maxPriceImpactBps: 200, maxSlippageBps: 100,
  maxOrderLifetimeMs: 120_000, maxQuoteAgeMs: 30_000 };
const asset: InvestmentAsset = {
  id: `prestocks:${mint}`, provider: "prestocks", marketType: "PRE_IPO", canonical: true,
  executionStatus: "UNKNOWN", mintAddress: mint, name: "Example Pre-IPO", symbol: "EX",
  description: null, imageUrl: null, tokenPriceUsd: 5,
};
const product: ProductSellReview = { operation: "SELL", assetId: asset.id,
  mintAddress: mint, provider: "prestocks", allowed: true,
  restrictionsComplete: true, tokenCompatibilityReviewed: true, evidenceId: "product-fixture",
  reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() };
const investor: InvestorSellReview = { operation: "SELL", principalId: principal.principalId,
  walletAddress: wallet, assetId: asset.id, mintAddress: mint, allowed: true,
  restrictionsComplete: true, evidenceId: "investor-fixture", reviewedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 3_600_000).toISOString() };
const owner: OwnerTokenSellReview = { operation: "SELL", walletAddress: wallet,
  mintAddress: mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS, decimals: 6,
  availableRaw: "5000000", allAccountsTransferable: true, evidenceId: "owner-fixture",
  validatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString() };
const mintInfo: MintInspection = { mint, program: TOKEN_2022_PROGRAM_ADDRESS, decimals: 6,
  supplyRaw: "10000000", mintAuthority: null, freezeAuthority: null, extensions: [] };
const token: TokenBalance = { mintAddress: mint, rawAmount: "5000000", decimals: 6,
  amount: "5", program: "token-2022" };
const quote: ReverseSellQuote = { inputMint: mint, outputMint: SOLANA_MAINNET_USDC_MINT,
  inputRaw: "3000000", outputRaw: "15000000", venues: ["fixture"], priceImpactPct: "0.1",
  quotedAt: new Date(now).toISOString(), expiresAt: new Date(now + 25_000).toISOString() };
const order: JupiterOrder = { requestId: "sell-order-1", inputMint: mint,
  outputMint: SOLANA_MAINNET_USDC_MINT, inAmount: "3000000", outAmount: "15000000",
  taker: wallet, router: "jupiter", mode: "ultra", feeBps: 10,
  feeMint: SOLANA_MAINNET_USDC_MINT, priceImpactPct: "0.1", transaction: "AQID",
  lastValidBlockHeight: "123456", expireAt: new Date(now + 20_000).toISOString() };

type Options = {
  asset?: InvestmentAsset; stale?: boolean; sourceAt?: string; mint?: MintInspection;
  product?: ProductSellReview | null; investor?: InvestorSellReview | null;
  owner?: OwnerTokenSellReview | null; balances?: TokenBalance[];
  quote?: ReverseSellQuote; order?: JupiterOrder; unsigned?: boolean;
  quoteError?: Error; balanceError?: Error; policy?: SellPolicy;
};
function setup(options: Options = {}) {
  const calls: string[] = [];
  const selected = structuredClone(options.asset ?? asset);
  const service = new ManualSellService({
    principal,
    registry: { getSnapshot: async () => ({ assets: [selected], stale: options.stale ?? false,
      sources: [{ provider: selected.provider, stale: options.stale ?? false,
        fetchedAt: options.sourceAt ?? new Date(now).toISOString() }] }) },
    inspectMint: async (address) => { calls.push(`mint:${address}`); return structuredClone(options.mint ?? mintInfo); },
    balances: { getTokenBalances: async (address) => {
      calls.push(`balances:${address}`); if (options.balanceError) throw options.balanceError;
      return structuredClone(options.balances ?? [token]);
    } },
    reverseQuote: async ({ inputMint, outputMint, amountRaw }) => {
      calls.push(`quote:${inputMint}:${outputMint}:${amountRaw}`);
      if (options.quoteError) throw options.quoteError;
      return structuredClone(options.quote ?? quote);
    },
    jupiter: { createOrder: async ({ inputMint, outputMint, amountRaw, taker }) => {
      calls.push(`order:${inputMint}:${outputMint}:${amountRaw}:${taker}`);
      return structuredClone(options.order ?? order);
    } },
    reviewProduct: async () => options.product === undefined ? structuredClone(product) : options.product,
    reviewInvestor: async () => options.investor === undefined ? structuredClone(investor) : options.investor,
    reviewOwnerAccounts: async () => options.owner === undefined ? structuredClone(owner) : options.owner,
    verifyUnsignedEnvelope: async () => { calls.push("unsigned-envelope"); return options.unsigned ?? true; },
    policy: options.policy ?? policy, now: () => now,
  });
  return { service, calls };
}
const request = { assetId: asset.id, amountRaw: "3000000", minimumUsdcOutRaw: "14500000" };
async function rejects(code: ManualSellErrorCode, options: Options = {}, input = request) {
  const fixture = setup(options);
  await assert.rejects(fixture.service.prepare(input), (error) => error instanceof ManualSellError && error.code === code);
  return fixture.calls;
}

test("reviewed Pre-IPO SELL prepares only a principal-bound unsigned, unvalidated reverse order", async () => {
  const { service, calls } = setup();
  const prepared = await service.prepare(request);
  assert.equal(prepared.assetId, asset.id);
  assert.equal(prepared.principalId, principal.principalId);
  assert.equal(prepared.walletAddress, wallet);
  assert.equal(prepared.inputMint, mint);
  assert.equal(prepared.outputMint, SOLANA_MAINNET_USDC_MINT);
  assert.equal(prepared.inputRaw, "3000000");
  assert.equal(prepared.requiredMinimumUsdcOutRaw, "14850000");
  assert.equal(prepared.transactionStatus, "REQUIRES_INSTRUCTION_VALIDATION");
  assert.equal(prepared.expiresAt, order.expireAt);
  assert.deepEqual(calls, [
    `mint:${mint}`, `balances:${wallet}`, `quote:${mint}:${SOLANA_MAINNET_USDC_MINT}:3000000`,
    `order:${mint}:${SOLANA_MAINNET_USDC_MINT}:3000000:${wallet}`, "unsigned-envelope",
  ]);
});

test("invalid input, ticker substitution and stale catalog stop before wallet/quote reads", async () => {
  assert.deepEqual(await rejects("INVALID_INPUT", {}, { ...request, assetId: "EX" }), []);
  assert.deepEqual(await rejects("INVALID_INPUT", {}, { ...request, amountRaw: "-1" }), []);
  assert.deepEqual(await rejects("INVALID_INPUT", {}, { ...request, minimumUsdcOutRaw: "0" }), []);
  assert.deepEqual(await rejects("CATALOG_UNAVAILABLE", { stale: true }), []);
  assert.deepEqual(await rejects("CATALOG_UNAVAILABLE", { sourceAt: new Date(now - 300_001).toISOString() }), []);
  assert.deepEqual(await rejects("ASSET_NOT_ALLOWED", {}, { ...request, assetId: `prestocks:${wallet}` }), []);
});

test("product and person SELL reviews are asset-, owner-, operation- and time-bound", async () => {
  await rejects("PRODUCT_REVIEW_REQUIRED", { product: null });
  await rejects("PRODUCT_REVIEW_REQUIRED", { product: { ...product, operation: "BUY" as "SELL" } });
  await rejects("PRODUCT_REVIEW_REQUIRED", { product: { ...product, mintAddress: wallet } });
  await rejects("PRODUCT_REVIEW_REQUIRED", { product: { ...product, tokenCompatibilityReviewed: false } });
  await rejects("PRODUCT_REVIEW_REQUIRED", { product: { ...product, reviewedAt: new Date(now - 86_400_001).toISOString() } });
  await rejects("PRODUCT_REVIEW_REQUIRED", { product: { ...product, expiresAt: new Date(now).toISOString() } });
  await rejects("INVESTOR_REVIEW_REQUIRED", { investor: null });
  await rejects("INVESTOR_REVIEW_REQUIRED", { investor: { ...investor, walletAddress: mint } });
  await rejects("INVESTOR_REVIEW_REQUIRED", { investor: { ...investor, principalId: "did:privy:other" } });
  await rejects("INVESTOR_REVIEW_REQUIRED", { investor: { ...investor, reviewedAt: new Date(now - 86_400_001).toISOString() } });
  await rejects("INVESTOR_REVIEW_REQUIRED", { investor: { ...investor, expiresAt: new Date(now).toISOString() } });
});

test("mint identity, unsafe extension and owner-token-account review fail closed", async () => {
  await rejects("TECHNICAL_REVIEW_REQUIRED", { mint: { ...mintInfo, mint: wallet } });
  await rejects("TECHNICAL_REVIEW_REQUIRED", { mint: { ...mintInfo,
    extensions: [{ name: "transferHook", state: { programId: wallet } }] } });
  await rejects("TECHNICAL_REVIEW_REQUIRED", { mint: { ...mintInfo,
    extensions: [{ name: "pausableConfig", state: { paused: true } }] } });
  await rejects("OWNER_ACCOUNT_REVIEW_REQUIRED", { owner: null });
  await rejects("OWNER_ACCOUNT_REVIEW_REQUIRED", { owner: { ...owner, walletAddress: mint } });
  await rejects("OWNER_ACCOUNT_REVIEW_REQUIRED", { owner: { ...owner, allAccountsTransferable: false } });
  await rejects("OWNER_ACCOUNT_REVIEW_REQUIRED", { balances: [{ ...token, decimals: 9, amount: "0.005" }] });
  await rejects("OWNER_ACCOUNT_REVIEW_REQUIRED", { balanceError: new Error("RPC down") });
  await rejects("INSUFFICIENT_ASSET_BALANCE", {}, { ...request, amountRaw: "5000001" });
});

test("multiple token accounts aggregate exact raw units and must match owner attestation", async () => {
  const accounts = [{ ...token, rawAmount: "2000000", amount: "2" },
    { ...token, rawAmount: "3000000", amount: "3" }];
  assert.equal((await setup({ balances: accounts }).service.prepare(request)).inputRaw, "3000000");
  await rejects("OWNER_ACCOUNT_REVIEW_REQUIRED", { balances: accounts,
    owner: { ...owner, availableRaw: "4999999" } });
});

test("reverse quote must be fresh and match official mint, canonical USDC, and exact raw amount", async () => {
  await rejects("QUOTE_UNAVAILABLE", { quoteError: new Error("provider down") });
  await rejects("QUOTE_UNAVAILABLE", { quote: { ...quote, inputMint: wallet } });
  await rejects("QUOTE_UNAVAILABLE", { quote: { ...quote, outputMint: mint } });
  await rejects("QUOTE_UNAVAILABLE", { quote: { ...quote, inputRaw: "3000001" } });
  await rejects("QUOTE_UNAVAILABLE", { quote: { ...quote, outputRaw: "0" } });
  await rejects("QUOTE_UNAVAILABLE", { quote: { ...quote, quotedAt: new Date(now - 30_001).toISOString() } });
  await rejects("ORDER_OUT_OF_POLICY", { quote: { ...quote, priceImpactPct: "2.01" } });
});

test("read-only Jupiter reverse quote uses a fixed origin and rejects wrong identity", async () => {
  const observed: URL[] = [];
  const fetcher = (async (url: URL) => {
    observed.push(url);
    return new Response(JSON.stringify({ inputMint: mint, outputMint: SOLANA_MAINNET_USDC_MINT,
      inAmount: "3000000", outAmount: "15000000", swapMode: "ExactIn", priceImpactPct: "0.1",
      routePlan: [{ swapInfo: { label: "venue" } }] }), { status: 200 });
  }) as typeof fetch;
  const result = await fetchJupiterReverseSellQuote({ inputMint: mint,
    outputMint: SOLANA_MAINNET_USDC_MINT, amountRaw: "3000000", slippageBps: 100 }, fetcher, () => now);
  assert.equal(observed[0]?.origin, "https://api.jup.ag");
  assert.equal(observed[0]?.searchParams.get("inputMint"), mint);
  assert.equal(observed[0]?.searchParams.get("outputMint"), SOLANA_MAINNET_USDC_MINT);
  assert.equal(observed[0]?.searchParams.get("amount"), "3000000");
  assert.equal(result.outputRaw, "15000000");
  assert.equal(result.expiresAt, new Date(now + 15_000).toISOString());
  await assert.rejects(fetchJupiterReverseSellQuote({ inputMint: mint,
    outputMint: SOLANA_MAINNET_USDC_MINT, amountRaw: "3000000", slippageBps: 100 },
  (async () => new Response(JSON.stringify({ inputMint: wallet, outputMint: SOLANA_MAINNET_USDC_MINT,
    inAmount: "3000000", outAmount: "15000000", swapMode: "ExactIn", priceImpactPct: "0.1",
    routePlan: [{ swapInfo: { label: "venue" } }] }), { status: 200 })) as typeof fetch,
  () => now), (error) => error instanceof ManualSellError && error.code === "QUOTE_UNAVAILABLE");
});

test("Jupiter order identity, taker, fee, impact, expiry, minimum output and unsigned proof stay bounded", async () => {
  for (const change of [{ inputMint: wallet }, { outputMint: mint }, { inAmount: "3000001" },
    { taker: mint }, { transaction: "bad!" }, { expireAt: null }, { lastValidBlockHeight: null }]) {
    await rejects("ORDER_UNAVAILABLE", { order: { ...order, ...change } });
  }
  for (const change of [{ feeBps: 51 }, { feeMint: wallet }, { priceImpactPct: "2.01" },
    { priceImpactPct: null }, { outAmount: "10000000" }, { outAmount: "14849999" }]) {
    await rejects("ORDER_OUT_OF_POLICY", { order: { ...order, ...change } });
  }
  await rejects("UNSIGNED_ENVELOPE_UNVERIFIED", { unsigned: false });
});

test("official xStocks SELL stays unavailable until catalog, multiplier and transfer reviews are complete", async () => {
  const stock: InvestmentAsset = { ...asset, id: `xstocks:${mint}`, provider: "xstocks", marketType: "PUBLIC_EQUITY",
    metadata: { issuerId: "fixture", sourceUrl: "https://issuer.example/asset", classificationSource: "https://issuer.example/classification",
      underlyingSymbol: "EX", underlyingIsin: null, productIsin: null, isTradingHalted: false },
    availability: { status: "REVIEW_REQUIRED", reason: "review", issuerTermsUrl: "https://issuer.example/terms",
      restrictedJurisdictions: [], restrictionsComplete: false, reviewedAt: null } };
  const stockRequest = { ...request, assetId: stock.id };
  await rejects("PRODUCT_REVIEW_REQUIRED", { asset: stock }, stockRequest);
  const reviewed: InvestmentAsset = { ...stock, availability: { ...stock.availability!, status: "AVAILABLE",
    restrictionsComplete: true, reviewedAt: new Date(now).toISOString() } };
  await rejects("TECHNICAL_REVIEW_REQUIRED", { asset: reviewed }, stockRequest);
  const scaleMint: MintInspection = { ...mintInfo, extensions: [{ name: "scaledUiAmountConfig", state: {
    multiplier: "1.1", newMultiplier: "1.1", newMultiplierEffectiveTimestamp: "0",
  } }] };
  const calls = await rejects("PRODUCT_REVIEW_REQUIRED", { asset: reviewed, mint: scaleMint }, stockRequest);
  assert.deepEqual(calls, [`mint:${mint}`]);

  const stockProduct: ProductSellReview = { ...product, assetId: stock.id, provider: "xstocks" };
  const stockInvestor: InvestorSellReview = { ...investor, assetId: stock.id };
  const prepared = await setup({ asset: reviewed, mint: scaleMint, product: stockProduct,
    investor: stockInvestor }).service.prepare(stockRequest);
  assert.equal(prepared.provider, "xstocks");
  assert.equal(prepared.inputUnits, "RAW_TOKEN_BASE_UNITS");
  assert.equal(prepared.transactionStatus, "REQUIRES_INSTRUCTION_VALIDATION");

  const nearActivation = { ...scaleMint, extensions: [{ name: "scaledUiAmountConfig", state: {
    multiplier: "1.1", newMultiplier: "1.2",
    newMultiplierEffectiveTimestamp: String(Math.floor((now + 60_000) / 1_000)),
  } }] };
  await rejects("TECHNICAL_REVIEW_REQUIRED", { asset: reviewed, mint: nearActivation }, stockRequest);
});
