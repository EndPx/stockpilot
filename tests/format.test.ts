import assert from "node:assert/strict";
import test from "node:test";
import { formatUsd, formatValuation } from "../apps/web/lib/format.js";

test("USD formatter rounds consistently and distinguishes zero from missing", () => {
  assert.equal(formatUsd(123.301992), "$123.30");
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(NaN), "—");
});

test("valuation formatter uses compact financial units", () => {
  assert.equal(formatValuation(161600000000), "$161.6B");
  assert.equal(formatValuation(1250000), "$1.3M");
  assert.equal(formatValuation(0), "$0");
  assert.equal(formatValuation(null), "—");
});
