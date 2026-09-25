import assert from "node:assert/strict";
import test from "node:test";
import { executeInvestment } from "../lib/investments/service";

const input = { requestId: `build:${"a".repeat(64)}`, signedTransaction: "offline-fixture-wire",
  lastValidBlockHeight: "12345" };
const signature = "1".repeat(88);

test("build submissions send the exact signed bytes once to configured RPC with preflight and no retries", async (t) => {
  const originalUrl = process.env.SOLANA_RPC_URL;
  process.env.SOLANA_RPC_URL = "https://rpc.example.test/";
  t.after(() => { if (originalUrl === undefined) delete process.env.SOLANA_RPC_URL; else process.env.SOLANA_RPC_URL = originalUrl; });
  const calls: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url, method: init?.method, cache: init?.cache,
      body: JSON.parse(String(init?.body)), signal: init?.signal });
    return Response.json({ jsonrpc: "2.0", id: 1, result: signature });
  });
  const result = await executeInvestment(input);
  assert.equal(calls.length, 1);
  const call = calls[0] as { url: string; method: string; cache: string; body: unknown; signal: AbortSignal };
  assert.equal(call.url, "https://rpc.example.test/");
  assert.equal(call.method, "POST");
  assert.equal(call.cache, "no-store");
  assert.ok(call.signal instanceof AbortSignal);
  assert.deepEqual(call.body, { jsonrpc: "2.0", id: 1, method: "sendTransaction",
    params: [input.signedTransaction, { encoding: "base64", skipPreflight: false,
      preflightCommitment: "confirmed", maxRetries: 0 }] });
  assert.deepEqual(result, { status: "Success", signature, code: null, error: null,
    totalInputAmount: null, totalOutputAmount: null });
});

test("a valid RPC preflight rejection is definitive and is never retried", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "simulation failed" } });
  });
  assert.deepEqual(await executeInvestment(input), { status: "Rejected", code: -32002 });
  assert.equal(count, 1);
});

test("ambiguous or malformed RPC responses never retry or invent a transaction signature", async (t) => {
  const cases = [
    async () => { throw new Error("connection lost after upload"); },
    async () => new Response("unavailable", { status: 503 }),
    async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "node unhealthy" } }),
    async () => Response.json({ jsonrpc: "2.0", id: 2, error: { code: -32002, message: "simulation failed" } }),
    async () => Response.json({ id: 1, error: { code: -32002, message: "simulation failed" } }),
    async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32002 } }),
    async () => Response.json({ jsonrpc: "2.0", id: 1, result: null, error: { code: -32002, message: "contradictory" } }),
    async () => Response.json({ result: "not-a-signature" }),
    async () => Response.json({ result: null }),
    async () => new Response("not-json"),
  ];
  for (const respond of cases) {
    let count = 0;
    const mocked = t.mock.method(globalThis, "fetch", async () => { count++; return respond(); });
    await assert.rejects(executeInvestment(input));
    assert.equal(count, 1);
    mocked.mock.restore();
  }
});
