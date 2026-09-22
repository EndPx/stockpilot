import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreStocks } from "@stockpilot/integrations/prestocks";

const row = {
  name: "SpaceX PreStocks", symbol: "SPACEX",
  contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
  tokenPrice: 123.301992, markPrice: 152.51,
  impliedValuation: 161600000000, markValuation: 199900000000,
};

test("normalizes provider identity and keeps token and mark values distinct", () => {
  const [asset] = normalizePreStocks([row]);
  assert.equal(asset.id, `prestocks:${row.contract_address}`);
  assert.equal(asset.provider, "prestocks");
  assert.equal(asset.marketType, "PRE_IPO");
  assert.equal(asset.mintAddress, row.contract_address);
  assert.equal(asset.tokenPriceUsd, row.tokenPrice);
  assert.equal(asset.markPriceUsd, row.markPrice);
  assert.equal(asset.impliedValuationUsd, row.impliedValuation);
  assert.equal(asset.markValuationUsd, row.markValuation);
  assert.equal(asset.description, null);
  assert.equal(asset.imageUrl, null);
  assert.equal(asset.supply, null);
});

test("missing or non-finite optional numbers are null, zero is retained", () => {
  const [asset] = normalizePreStocks([{ ...row, tokenPrice: "123", markPrice: NaN, supply: 0, impliedValuation: Infinity }]);
  assert.equal(asset.tokenPriceUsd, null);
  assert.equal(asset.markPriceUsd, null);
  assert.equal(asset.impliedValuationUsd, null);
  assert.equal(asset.supply, 0);
});

test("rejects malformed registries, required fields, and invalid mints", () => {
  for (const payload of [null, {}, "assets", [null], [[]], [42], [{}], [{ ...row, symbol: " " }], [{ ...row, contract_address: "not-a-mint" }]]) {
    assert.throws(() => normalizePreStocks(payload), /PreStocks/);
  }
  assert.deepEqual(normalizePreStocks([]), []);
});

test("remote image and external URLs accept only HTTP(S)", () => {
  const [unsafe] = normalizePreStocks([{ ...row, image: "data:image/svg+xml,unsafe", external_url: "javascript:alert(1)" }]);
  assert.equal(unsafe.imageUrl, null);
  assert.equal(unsafe.externalUrl, null);
  const [safe] = normalizePreStocks([{ ...row, image: "https://prestocks.com/logos/spacex.png", external_url: "https://prestocks.com/spacex" }]);
  assert.equal(safe.imageUrl, "https://prestocks.com/logos/spacex.png");
  assert.equal(safe.externalUrl, "https://prestocks.com/spacex");
});
