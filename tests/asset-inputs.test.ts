import assert from "node:assert/strict";
import test from "node:test";
import { parseAssetQuery, parseAssetSymbol, InvalidAssetInput } from "../apps/web/lib/asset-inputs.js";

test("search accepts text and rejects repeated, oversized, or control-character input", () => {
  assert.equal(parseAssetQuery(undefined), "");
  assert.equal(parseAssetQuery(" SpaceX "), "SpaceX");
  for (const value of [["a", "b"], "x".repeat(101), "hello\nworld"]) {
    assert.throws(() => parseAssetQuery(value), InvalidAssetInput);
  }
});

test("symbol validation accepts case variants and rejects invalid route input", () => {
  assert.equal(parseAssetSymbol("spacex"), "spacex");
  for (const value of ["", "two words", "../spacex", "x".repeat(33)]) {
    assert.throws(() => parseAssetSymbol(value), InvalidAssetInput);
  }
});
