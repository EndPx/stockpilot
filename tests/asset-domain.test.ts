import assert from "node:assert/strict";
import test from "node:test";

test("public ETF and generic discovery classifications do not permit private xStocks", () => {
  assert.equal(isSupportedClassification({ marketType: "ETF", provider: "xstocks" }), true);
  assert.equal(isSupportedClassification({ marketType: "PUBLIC_MARKET_PRODUCT", provider: "xstocks" }), true);
  assert.equal(isSupportedClassification({ marketType: "PRE_IPO", provider: "xstocks" }), false);
});
import { isSupportedClassification } from "@stockpilot/integrations/asset-domain";

test("PRE_IPO + PRESTOCKS is allowed", () => {
  assert.equal(isSupportedClassification({ marketType: "PRE_IPO", provider: "prestocks" }), true);
});
test("PRE_IPO + XSTOCKS is rejected", () => {
  assert.equal(isSupportedClassification({ marketType: "PRE_IPO", provider: "xstocks" }), false);
});
test("PRE_IPO + unknown provider is rejected", () => {
  for (const provider of ["tessera", "custom", "", undefined]) {
    assert.equal(isSupportedClassification({ marketType: "PRE_IPO", provider }), false);
  }
});
test("PUBLIC_EQUITY + XSTOCKS is allowed as a category, not trading authorization", () => {
  assert.equal(isSupportedClassification({ marketType: "PUBLIC_EQUITY", provider: "xstocks" }), true);
  assert.equal(isSupportedClassification({ marketType: "PUBLIC_EQUITY", provider: "prestocks" }), false);
});
test("arbitrary SPL token classification is rejected", () => {
  assert.equal(isSupportedClassification({ marketType: "CRYPTO", provider: "spl" }), false);
  assert.equal(isSupportedClassification({}), false);
});
