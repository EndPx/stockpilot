import assert from "node:assert/strict";
import test from "node:test";
import {
  JupiterOrderNotExecutableError,
  JupiterV2Adapter,
  normalizeJupiterExecution,
  normalizeJupiterOrder,
} from "@stockpilot/integrations/jupiter-v2";

const expected = {
  inputMint: "input-mint",
  outputMint: "output-mint",
  amountRaw: "50000000",
  taker: "wallet",
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "request-one",
    inputMint: expected.inputMint,
    outputMint: expected.outputMint,
    inAmount: expected.amountRaw,
    outAmount: "123",
    taker: expected.taker,
    router: "metis",
    mode: "ultra",
    feeBps: 10,
    feeMint: expected.inputMint,
    priceImpactPct: "0.01",
    transaction: "AQID",
    lastValidBlockHeight: 123,
    expireAt: null,
    ...overrides,
  };
}

test("normalizes a current V2 order and preserves validity fields", () => {
  const normalized = normalizeJupiterOrder(order(), expected);
  assert.equal(normalized.lastValidBlockHeight, "123");
  assert.equal(normalized.feeBps, 10);
  assert.equal(normalized.priceImpactPct, "0.01");
});

test("rejects orders that substitute any server-requested investment field", () => {
  for (const changed of [
    { inputMint: "attacker" },
    { outputMint: "attacker" },
    { inAmount: "1" },
    { taker: "attacker" },
  ]) {
    assert.throws(() => normalizeJupiterOrder(order(changed), expected), /invalid investment order/);
  }
});

test("rejects quote-only or structured-error orders without an executable transaction", () => {
  assert.throws(
    () => normalizeJupiterOrder(order({ transaction: null, errorCode: -2 }), expected),
    (error) => error instanceof JupiterOrderNotExecutableError && error.providerCode === -2,
  );
  assert.throws(() => normalizeJupiterOrder(order({ transaction: "" }), expected), JupiterOrderNotExecutableError);
});

test("the adapter sends only the four default Meta-Aggregator order parameters", async () => {
  let seenUrl: URL | undefined;
  let seenHeaders: Headers | undefined;
  const fetchMock: typeof fetch = async (input, init) => {
    seenUrl = new URL(input.toString());
    seenHeaders = new Headers(init?.headers);
    return Response.json(order());
  };
  const adapter = new JupiterV2Adapter("server-secret", fetchMock, "https://example.test");
  await adapter.createOrder(expected);
  assert.deepEqual([...seenUrl!.searchParams.keys()].sort(), ["amount", "inputMint", "outputMint", "taker"]);
  assert.equal(seenUrl!.pathname, "/swap/v2/order");
  assert.equal(seenHeaders!.get("x-api-key"), "server-secret");
});

test("execute posts only signed transaction, request id, and bound block height", async () => {
  let body: unknown;
  const fetchMock: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      status: "Success",
      signature: "signature",
      totalInputAmount: "50000000",
      totalOutputAmount: "123",
    });
  };
  const result = await new JupiterV2Adapter("key", fetchMock, "https://example.test").execute({
    signedTransaction: "signed",
    requestId: "request-one",
    lastValidBlockHeight: "123",
  });
  assert.deepEqual(body, {
    signedTransaction: "signed",
    requestId: "request-one",
    lastValidBlockHeight: "123",
  });
  assert.equal(result.status, "Success");
});

test("normalizes structured execution failure without pretending it succeeded", () => {
  assert.deepEqual(normalizeJupiterExecution({ status: "Failed", code: -2003, error: "expired" }), {
    status: "Failed",
    signature: null,
    code: -2003,
    error: "expired",
    totalInputAmount: null,
    totalOutputAmount: null,
  });
});
