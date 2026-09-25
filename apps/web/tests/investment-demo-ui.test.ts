import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/demo-trade-form.tsx", import.meta.url), "utf8");

test("trade review releases the native modal before opening Privy's signing portal", () => {
  const submit = source.slice(source.indexOf("async function submit()"), source.indexOf("async function checkStatus()"));
  const close = submit.indexOf("dialogRef.current?.close()");
  const sign = submit.indexOf("await sign(");
  assert.ok(close >= 0 && sign > close);
  assert.match(source, /Waiting for wallet approval/);
  assert.match(source, /Submitting trade/);
});

test("manual trade UI leaves the amount editable without claiming a fixed test cap", () => {
  assert.match(source, /onChange=\{\(event\) => setAmount\(event.target.value\)\}/);
  assert.doesNotMatch(source, /max \$0\.10|up to \$0\.10/);
});
