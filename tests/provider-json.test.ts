import assert from "node:assert/strict";
import test from "node:test";
import { readProviderJson } from "../packages/integrations/src/provider-json.js";

test("provider JSON accepts the byte limit and decodes UTF-8 across chunks", async () => {
  const bytes = new TextEncoder().encode('{"name":"é"}');
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }));
  assert.deepEqual(await readProviderJson(response, bytes.byteLength), { name: "é" });
});

test("provider JSON cancels oversized streams before reading the remaining body", async () => {
  for (const headers of [new Headers(), new Headers({ "content-length": "1" })]) {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(16).fill(32));
        if (reads === 100) controller.close();
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await assert.rejects(readProviderJson(new Response(body, { headers }), 32), /byte limit/);
    assert.equal(reads, 3);
    assert.equal(cancelled, true);
  }
});

test("provider JSON rejects a declared oversized body without consuming it", async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { reads++; },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(readProviderJson(new Response(body, {
    headers: { "content-length": "33" },
  }), 32), /byte limit/);
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
});

test("provider JSON rejects absent and malformed bodies", async () => {
  await assert.rejects(readProviderJson(new Response(null)), /no JSON body/);
  await assert.rejects(readProviderJson(new Response("{")), SyntaxError);
});
