import assert from "node:assert/strict";
import test from "node:test";
import { demoTradeProductSupported, demoWalletAllowed, parseDemoTradeAmount, parseDemoTradeRequest, resolveDemoAsset } from "../lib/investments/demo-trade";
import { marketRegistry } from "../lib/markets";

const wallet = "6EuMFHPtiyoFtsBTy1hiJpNgupP7qkZfZm9ErQ58ipsC";
const pre = "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP";
const stock = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";

test("manual asset checks request blocking fresh snapshots and still reject stale issuer data", async (context) => {
  const asset = { id: `xstocks:${stock}`, provider: "xstocks" as const, marketType: "PUBLIC_EQUITY" as const,
    canonical: true, executionStatus: "UNKNOWN" as const, mintAddress: stock, symbol: "AAPLx", name: "Apple xStock",
    description: null, imageUrl: null, tokenPriceUsd: null, metadata: { isTradingHalted: false } };
  let age = 0;
  let stale = false;
  let read: unknown[] = [];
  context.mock.method(marketRegistry, "getSnapshot", async (...args: unknown[]) => {
    read = args;
    return { assets: [asset], sources: [{ provider: "xstocks", fetchedAt: new Date(Date.now() - age).toISOString(), stale }], stale };
  });
  assert.equal((await resolveDemoAsset("xstocks", stock)).mintAddress, stock);
  assert.deepEqual(read, ["xstocks", { maxAgeMs: 45_000, waitForRefresh: true }]);
  age = 120_000;
  await assert.rejects(resolveDemoAsset("xstocks", stock), /fresh issuer catalog/i);
  age = 0;
  stale = true;
  await assert.rejects(resolveDemoAsset("xstocks", stock), /fresh issuer catalog/i);
});

test("manual amounts are user-defined, not capped at the $0.10 test amount", () => {
  assert.equal(parseDemoTradeAmount("0.1", 6), 100_000n);
  assert.equal(parseDemoTradeAmount("1.25", 6), 1_250_000n);
  assert.equal(parseDemoTradeAmount("1000", 6), 1_000_000_000n);
  assert.equal(parseDemoTradeAmount("1.23456789", 8), 123_456_789n);
  for (const invalid of ["0", "-1", "1e2", "NaN", "0.0000001", "18446744073709.551616"]) {
    assert.throws(() => parseDemoTradeAmount(invalid, 6));
  }
});

test("demo assets are exactly one Pre-IPO and one xStock mint", () => {
  assert.equal(demoTradeProductSupported("prestocks", pre), true);
  assert.equal(demoTradeProductSupported("xstocks", stock), true);
  assert.equal(demoTradeProductSupported("prestocks", stock), false);
  assert.equal(demoTradeProductSupported("xstocks", pre), false);
});

test("demo wallet is denied without an exact operator allowlist", () => {
  const old = process.env.STOCKPILOT_DEMO_TRADER_WALLET;
  try {
    delete process.env.STOCKPILOT_DEMO_TRADER_WALLET;
    assert.equal(demoWalletAllowed(wallet), false);
    process.env.STOCKPILOT_DEMO_TRADER_WALLET = wallet;
    assert.equal(demoWalletAllowed(wallet), true);
    assert.equal(demoWalletAllowed("So11111111111111111111111111111111111111112"), false);
  } finally {
    if (old === undefined) delete process.env.STOCKPILOT_DEMO_TRADER_WALLET;
    else process.env.STOCKPILOT_DEMO_TRADER_WALLET = old;
  }
});

test("demo request requires explicit non-US attestation and exact body shape", () => {
  const request = { side: "BUY", provider: "prestocks", mintAddress: pre,
    amount: "0.1", eligibleNonUsAttestation: true };
  assert.deepEqual(parseDemoTradeRequest(request), request);
  assert.throws(() => parseDemoTradeRequest({ ...request, eligibleNonUsAttestation: false }));
  assert.throws(() => parseDemoTradeRequest({ ...request, clientWallet: wallet }));
  assert.throws(() => parseDemoTradeRequest({ ...request, side: "AUTO" }));
});
