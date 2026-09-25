import assert from "node:assert/strict";
import test from "node:test";
import { address, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import {
  assembleJupiterBuildTransaction,
  JupiterOrderError,
  JupiterOrderNotExecutableError,
  JupiterV2Adapter,
  normalizeJupiterBuild,
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

const buildInput = { ...expected, slippageBps: 100 };
const instruction = { programId: "program", accounts: [{ pubkey: "wallet", isSigner: true, isWritable: true }], data: "AQID" };

function build(overrides: Record<string, unknown> = {}) {
  return {
    inputMint: expected.inputMint, outputMint: expected.outputMint,
    inAmount: expected.amountRaw, outAmount: "123", otherAmountThreshold: "121",
    swapMode: "ExactIn", slippageBps: 100, priceImpactPct: "0.01",
    routePlan: [{ swapInfo: { label: "Manifest" } }],
    computeBudgetInstructions: [], setupInstructions: [instruction], swapInstruction: instruction,
    cleanupInstruction: null, otherInstructions: [], tipInstruction: null,
    addressesByLookupTableAddress: {},
    blockhashWithMetadata: { blockhash: Array(32).fill(1), lastValidBlockHeight: 123 },
    ...overrides,
  };
}

test("build normalization binds both mints, exact input, slippage, and output threshold", () => {
  const normalized = normalizeJupiterBuild(build(), buildInput);
  assert.equal(normalized.otherAmountThreshold, "121");
  assert.equal(normalized.setupInstructions.length, 1);
  for (const wrong of [
    { outputMint: "another-mint" }, { inAmount: "1" }, { slippageBps: 500 },
    { swapMode: "ExactOut" }, { otherAmountThreshold: "124" },
    { priceImpactPct: "10" },
    { blockhashWithMetadata: { blockhash: Array(31).fill(1), lastValidBlockHeight: 123 } },
  ]) assert.throws(() => normalizeJupiterBuild(build(wrong), buildInput), JupiterOrderError);
});

test("build requests raw instructions without asking Jupiter to submit", async () => {
  let url: URL | undefined;
  const adapter = new JupiterV2Adapter(null, async (input) => {
    url = new URL(input.toString());
    return Response.json(build());
  }, "https://example.test");
  await adapter.build(buildInput);
  assert.equal(url?.pathname, "/swap/v2/build");
  assert.deepEqual([...url!.searchParams.keys()].sort(), ["amount", "inputMint", "outputMint", "slippageBps", "taker"]);
});

test("direct build requires the exact server-selected one-hop DEX", async () => {
  const urls: URL[] = [];
  const adapter = new JupiterV2Adapter(null, async (input) => {
    urls.push(new URL(input.toString()));
    return Response.json(build());
  }, "https://example.test");
  const direct = { ...buildInput, directDex: "Meteora DLMM" as const };
  await assert.rejects(adapter.build(direct), JupiterOrderError);
  assert.equal(urls[0].searchParams.get("dexes"), "Meteora DLMM");
  const good = new JupiterV2Adapter(null, async () => Response.json(build({
    routePlan: [{ swapInfo: { label: "Meteora DLMM" } }],
  })), "https://example.test");
  assert.equal((await good.build(direct)).routePlan[0].swapInfo.label, "Meteora DLMM");
});

test("assembler compiles a wallet-fee-payer v0 transaction without signing it", () => {
  const wallet = "6EuMFHPtiyoFtsBTy1hiJpNgupP7qkZfZm9ErQ58ipsC";
  const ix = { programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    accounts: [{ pubkey: wallet, isSigner: true, isWritable: true }], data: "AQID" };
  const normalized = normalizeJupiterBuild(build({ setupInstructions: [], swapInstruction: ix }), buildInput);
  const wire = assembleJupiterBuildTransaction(normalized, wallet);
  const transaction = getTransactionDecoder().decode(Buffer.from(wire, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  assert.equal(message.version, 0);
  assert.equal(message.staticAccounts[0], wallet);
  assert.equal(message.header.numSignerAccounts, 1);
  assert.equal(transaction.signatures[address(wallet)], null);
});

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

test("keyless Jupiter requests omit the API-key header", async () => {
  const seen: Headers[] = [];
  const fetchMock: typeof fetch = async (_input, init) => {
    seen.push(new Headers(init?.headers));
    return init?.method === "POST"
      ? Response.json({ status: "Failed", code: -1000 })
      : Response.json(order());
  };
  const adapter = new JupiterV2Adapter(null, fetchMock, "https://example.test");
  await adapter.createOrder(expected);
  await adapter.execute({ signedTransaction: "signed", requestId: "request-one" });
  assert.equal(seen.length, 2);
  assert.equal(seen.every((headers) => !headers.has("x-api-key")), true);
});

test("execute posts only signed transaction, request id, and bound block height", async () => {
  let body: unknown;
  const fetchMock: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      status: "Success",
      signature: "1".repeat(64),
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
