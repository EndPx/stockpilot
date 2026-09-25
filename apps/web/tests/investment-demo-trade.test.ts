import assert from "node:assert/strict";
import test from "node:test";
import { demoTradeProductSupported, demoWalletAllowed, parseDemoTradeRequest } from "../lib/investments/demo-trade";

const wallet = "6EuMFHPtiyoFtsBTy1hiJpNgupP7qkZfZm9ErQ58ipsC";
const pre = "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP";
const stock = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";

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
