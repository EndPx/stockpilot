import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTokenAmount } from "@stockpilot/core/token-amounts";
const scale = { multiplier: "1", newMultiplier: "1.25", newMultiplierEffectiveTimestamp: "100" };
test("legacy and Token-2022 without scale retain exact raw/decimal semantics", () => {
  for (const decimals of [0, 6, 8, 9]) {
    const result = normalizeTokenAmount({ rawAmount: "100000000", decimals, unixSeconds: 0n });
    assert.equal(result.displaySource, "RAW_DECIMALS"); assert.equal(result.scaleMultiplier, null);
  }
  assert.equal(normalizeTokenAmount({ rawAmount: "18446744073709551615", decimals: 8, unixSeconds: 0n }).baseUiAmount, "184467440737.09551615");
});
test("selects scheduled multiplier at exact activation and truncates only display precision", () => {
  const input = { rawAmount: "12345", decimals: 2, scale, unixSeconds: 99n };
  assert.equal(normalizeTokenAmount(input).displayAmount, "123.45");
  assert.equal(normalizeTokenAmount({ ...input, unixSeconds: 100n }).displayAmount, "154.31");
  assert.equal(normalizeTokenAmount({ ...input, rawAmount: "0", unixSeconds: 100n }).displayAmount, "0");
  assert.equal(normalizeTokenAmount({ ...input, rawAmount: "18446744073709551615", unixSeconds: 100n }).displayAmount, "230584300921369395.18");
});
test("AAPLx fixture uses effective multiplier and never double-scales RPC strings", () => {
  const input = { rawAmount: "100000000", decimals: 8, unixSeconds: 1786149000n, scale: { multiplier: "1.0026642075893797", newMultiplier: "1.0032690125398187", newMultiplierEffectiveTimestamp: "1786149000" } };
  assert.equal(normalizeTokenAmount(input).calculatedScaledUiAmount, "1.00326901");
  assert.equal(normalizeTokenAmount({ ...input, rpcUiAmountString: "1.00326901" }).displayAmount, "1.00326901");
  assert.equal(normalizeTokenAmount({ ...input, rpcUiAmountString: "1.00326901" }).displaySource, "RPC_SCALED");
});
test("malformed raw/scale/decimals/display data fail closed", () => {
  for (const rawAmount of ["-1", "1e6", "1.2", "NaN", "18446744073709551616", "01"]) assert.throws(() => normalizeTokenAmount({ rawAmount, decimals: 8, unixSeconds: 0n }));
  for (const multiplier of ["0", "-1", "NaN", "Infinity", "1e999"]) assert.throws(() => normalizeTokenAmount({ rawAmount: "1", decimals: 8, unixSeconds: 0n, scale: { ...scale, multiplier } }));
  assert.throws(() => normalizeTokenAmount({ rawAmount: "1", decimals: -1, unixSeconds: 0n }));
  assert.throws(() => normalizeTokenAmount({ rawAmount: "1", decimals: 8, unixSeconds: 0n, scale, rpcUiAmountString: "NaN" }));
});
