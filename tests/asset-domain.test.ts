import assert from "node:assert/strict";
import test from "node:test";
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
