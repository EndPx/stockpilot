import assert from "node:assert/strict";
import test from "node:test";
import { InvestmentAssetRegistry } from "@stockpilot/core/asset-registry";
import { ExecutionEligibilityService, type ProductReview } from "@stockpilot/core/execution-eligibility";
import { normalizeXStock } from "@stockpilot/integrations/xstocks";
import { normalizeMintInspection, quoteMarketMint, MarketQuoteError, type MintInspection } from "@stockpilot/integrations/market-validation";
import { SOLANA_MAINNET_USDC_MINT, TOKEN_2022_PROGRAM_ADDRESS } from "@stockpilot/core/solana";

const mintAddress = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const asset = normalizeXStock({ id: "9e43a778-fdc8-44f1-87de-f2e7420bb7f7", name: "Apple", symbol: "AAPLx", isTradingHalted: false, isin: "CH1436219187", underlying: { isin: "US0378331005" }, deployments: [{ network: "Solana", address: mintAddress }] });
const mint: MintInspection = { mint: mintAddress, program: TOKEN_2022_PROGRAM_ADDRESS, decimals: 8, supplyRaw: "100000000", mintAuthority: null, freezeAuthority: null, extensions: [] };
const quote = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mintAddress, inputRaw: "1000000", outputRaw: "291895", venues: ["Fixture"] };
const review: ProductReview = { assetId: asset.id, mint: mintAddress, evidenceUrl: "https://example.com/review", expiresAt: "2027-01-01T00:00:00Z", restrictionsComplete: true, restricted: false, tokenCompatibilityReviewed: true };
function setup(options: { mint?: MintInspection; cleared?: boolean; noRoute?: boolean } = {}) {
  let now = Date.parse("2026-09-23T00:00:00Z"); let calls = 0; let stale = false;
  const registry = new InvestmentAssetRegistry([{ provider: "xstocks", marketType: "PUBLIC_MARKET_PRODUCT", getSnapshot: async () => ({ assets: [structuredClone(asset)], fetchedAt: new Date(now).toISOString(), stale }) }]);
  const service = new ExecutionEligibilityService(registry, {
    now: () => now, inspect: async () => { calls++; return structuredClone(options.mint ?? mint); },
    quote: async () => { if (options.noRoute) throw new MarketQuoteError("NO_JUPITER_ROUTE"); return quote; },
    review: () => options.cleared ? review : null,
  });
  return { service, calls: () => calls, advance: () => { now += 30_001; }, stale: () => { stale = true; } };
}
test("discovered asset remains UNKNOWN until lazy validation; a route alone never makes it executable", async () => {
  const { service } = setup(); assert.equal(service.getCachedStatus(asset.id), "UNKNOWN");
  const result = await service.validateForExecution(asset.id);
  assert.equal(result.status, "UNAVAILABLE"); assert.equal(result.reason, "PRODUCT_AND_TOKEN_REVIEW_REQUIRED");
  assert.equal(result.findings.quote?.outputRaw, "291895"); assert.equal(asset.executionStatus, "UNKNOWN");
});
test("complete server-owned evidence permits only expiring technical status, shared and immutable", async () => {
  const fixture = setup({ cleared: true });
  const [a, b] = await Promise.all([fixture.service.validateForExecution(asset.id), fixture.service.validateForExecution(asset.id)]);
  assert.equal(a.status, "EXECUTABLE"); assert.equal(b.status, "EXECUTABLE"); assert.equal(fixture.calls(), 1);
  a.findings.blockers.push("mutation");
  assert.deepEqual((await fixture.service.validateForExecution(asset.id)).findings.blockers, []);
  fixture.advance(); assert.equal(fixture.service.getCachedStatus(asset.id), "UNKNOWN");
  await fixture.service.validateForExecution(asset.id); assert.equal(fixture.calls(), 2);
  fixture.stale(); assert.equal((await fixture.service.validateForExecution(asset.id)).reason, "STALE_REGISTRY");
  assert.equal(fixture.service.getCachedStatus(asset.id), "UNKNOWN");
});
test("arbitrary SPL and forged ticker/mint identities never cause RPC reads", async () => {
  const fixture = setup();
  for (const id of ["AAPLx", "xstocks:So11111111111111111111111111111111111111112", "prestocks:" + mintAddress]) assert.equal((await fixture.service.validateForExecution(id)).reason, "UNREGISTERED_ASSET");
  assert.equal(fixture.calls(), 0);
});
test("pause, frozen default, hooks, unknown extensions and missing routes fail closed", async () => {
  for (const [name, state, expected] of [
    ["pausableConfig", { paused: true }, "RESTRICTED"],
    ["defaultAccountState", { accountState: "frozen" }, "RESTRICTED"],
    ["transferHook", { programId: mintAddress }, "UNSUPPORTED"],
    ["transferFeeConfig", {}, "UNSUPPORTED"],
    ["futureExtension", {}, "UNSUPPORTED"],
    ["pausableConfig", {}, "UNSUPPORTED"],
    ["scaledUiAmountConfig", { multiplier: "bad" }, "UNSUPPORTED"],
  ] as const) {
    const { service } = setup({ cleared: true, mint: { ...mint, extensions: [{ name, state }] } });
    assert.equal((await service.validateForExecution(asset.id)).status, expected);
  }
  assert.equal((await setup({ cleared: true, noRoute: true }).service.validateForExecution(asset.id)).reason, "NO_JUPITER_ROUTE");
});
test("scheduled scale change bounds cached validation lifetime", async () => {
  const activation = Date.parse("2026-09-23T00:00:10Z") / 1000;
  const { service } = setup({ cleared: true, mint: { ...mint, extensions: [{ name: "scaledUiAmountConfig", state: { multiplier: "1", newMultiplier: "1.1", newMultiplierEffectiveTimestamp: activation } }] } });
  assert.equal((await service.validateForExecution(asset.id)).expiresAt, "2026-09-23T00:00:10.000Z");
});
test("mint decoder requires initialized mint and preserves states without token-name trust", () => {
  const account = { owner: TOKEN_2022_PROGRAM_ADDRESS, data: { parsed: { type: "mint", info: { decimals: 8, supply: "18446744073709551615", isInitialized: true, mintAuthority: null, freezeAuthority: null, extensions: [] } } } };
  assert.equal(normalizeMintInspection(mintAddress, account).supplyRaw, "18446744073709551615");
  assert.throws(() => normalizeMintInspection(mintAddress, { ...account, owner: mintAddress }));
  account.data.parsed.info.isInitialized = false; assert.throws(() => normalizeMintInspection(mintAddress, account));
});
test("Jupiter integration performs GET quote only and verifies canonical pair/raw amount", async () => {
  let outputMint = mintAddress;
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(new URL(String(url)).pathname, "/swap/v1/quote");
    assert.equal(options?.method, undefined); assert.equal(options?.body, undefined);
    return Response.json({ inputMint: SOLANA_MAINNET_USDC_MINT, outputMint, inAmount: "1000000", outAmount: "10", swapMode: "ExactIn", routePlan: [{ swapInfo: { label: "Fixture" } }] });
  };
  assert.equal((await quoteMarketMint(mintAddress, fetcher)).outputRaw, "10");
  outputMint = SOLANA_MAINNET_USDC_MINT; await assert.rejects(quoteMarketMint(mintAddress, fetcher));
});

test("issuer outage or unavailable/unknown state cannot be overridden by a positive review", async () => {
  const provider = { provider: "xstocks" as const, marketType: "PUBLIC_MARKET_PRODUCT" as const, getSnapshot: async () => { throw new Error("upstream details"); } };
  assert.equal((await new ExecutionEligibilityService(new InvestmentAssetRegistry([provider])).validateForExecution(asset.id)).reason, "REGISTRY_UNAVAILABLE");
  for (const unknownHalt of [false, true]) {
    const row = structuredClone(asset);
    if (unknownHalt) row.metadata!.isTradingHalted = null; else row.availability!.status = "UNAVAILABLE";
    const registry = new InvestmentAssetRegistry([{ ...provider, getSnapshot: async () => ({ assets: [row], fetchedAt: new Date().toISOString(), stale: false }) }]);
    let quotes = 0;
    const service = new ExecutionEligibilityService(registry, { inspect: async () => mint, quote: async () => { quotes++; return quote; }, review: () => review });
    assert.equal((await service.validateForExecution(asset.id)).status, "UNAVAILABLE"); assert.equal(quotes, 0);
  }
});
