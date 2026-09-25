import assert from "node:assert/strict";
import test from "node:test";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import { executeManualBuyOnce } from "../lib/investments/manual-execution";
import type { InvestmentAuthorization } from "../lib/investments/authorization";
import type { ManualBuyExecutionRecord } from "../lib/control-plane/manual-executions";

const wallet = "PreY4UP8myYbeugNjN5B9LzL6ybRc4XqYEPzYBscQwV";
const mint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const signature = "1".repeat(88);

function authorization(): InvestmentAuthorization {
  return {
    kind: "investment", walletAddress: wallet, requestId: "jupiter-order-one",
    inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mint,
    inputAmountRaw: "1000000", outputDecimals: 9, symbol: "SPACEX",
    requiredMinimumOutputRaw: "8000000", maximumWalletNativeDebitLamportsRaw: "1000000",
    messageFingerprint: "a".repeat(43), lastValidBlockHeight: null,
    orderExpireAt: null, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
  };
}

function record(status: ManualBuyExecutionRecord["status"] = "CLAIMED"): ManualBuyExecutionRecord {
  return {
    id: crypto.randomUUID(), accountId: "did:privy:owner", walletAddress: wallet,
    providerRequestId: "jupiter-order-one", transactionSignature: signature,
    messageFingerprint: "a".repeat(43), inputMint: SOLANA_MAINNET_USDC_MINT,
    side: "BUY", inputDecimals: 6,
    outputMint: mint, inputAmountRaw: "1000000", outputDecimals: 9,
    requiredMinimumOutputRaw: "8000000", maximumWalletNativeDebitLamportsRaw: "1000000",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    submittedAt: status === "SUBMITTED" ? new Date().toISOString() : null,
    resolvedAt: null, actualInputAmountRaw: null, actualOutputAmountRaw: null,
    actualWalletNativeDebitLamportsRaw: null,
  };
}

const input = () => ({ accountId: "did:privy:owner", walletAddress: wallet,
  authorization: authorization(), signedTransaction: "synthetic-signed-wire" });

test("one durable claim is the only path that sends a signed BUY to Jupiter", async () => {
  let claimed = false;
  let executions = 0;
  const common = {
    async assertSigned() {},
    signature: () => signature,
    async claim() {
      if (claimed) return { claimed: false, record: record("SUBMITTED") };
      claimed = true;
      return { claimed: true, record: record() };
    },
    async markSubmitted() { return record("SUBMITTED"); },
    async readChain() { return { status: "PENDING" as const }; },
    async execute() {
      executions += 1;
      return { status: "Success" as const, signature, code: null, error: null,
        totalInputAmount: "1000000", totalOutputAmount: "10000000" };
    },
  };
  const first = await executeManualBuyOnce(input(), common);
  const repeat = await executeManualBuyOnce(input(), common);
  assert.deepEqual(first, { status: "PENDING", requestId: "jupiter-order-one", signature });
  assert.deepEqual(repeat, first);
  assert.equal(executions, 1);
});

test("manual SELL binds direction and input decimals before its one provider submission", async () => {
  let claimed: unknown;
  let chainInput: unknown;
  const sellAuthorization: InvestmentAuthorization = { ...authorization(), side: "SELL",
    inputMint: mint, outputMint: SOLANA_MAINNET_USDC_MINT, inputDecimals: 9,
    outputDecimals: 6, inputAmountRaw: "100000000", requiredMinimumOutputRaw: "1000000" };
  const result = await executeManualBuyOnce({ ...input(), authorization: sellAuthorization }, {
    async assertSigned() {}, signature: () => signature,
    async claim(value) { claimed = value; return { claimed: true, record: { ...record(), side: "SELL",
      inputMint: mint, outputMint: SOLANA_MAINNET_USDC_MINT, inputDecimals: 9, outputDecimals: 6 } }; },
    async execute() { return { status: "Success", signature, code: null, error: null,
      totalInputAmount: "100000000", totalOutputAmount: "1100000" }; },
    async markSubmitted() { return record("SUBMITTED"); },
    async readChain(value) { chainInput = value; return { status: "PENDING" }; },
  });
  assert.equal(result.side, "SELL");
  assert.equal((claimed as { side: string }).side, "SELL");
  assert.equal((claimed as { inputDecimals: number }).inputDecimals, 9);
  assert.equal((chainInput as { side: string }).side, "SELL");
});

test("provider success alone remains pending until finalized chain evidence", async () => {
  let settled = false;
  const result = await executeManualBuyOnce(input(), {
    async assertSigned() {}, signature: () => signature,
    async claim() { return { claimed: true, record: record() }; },
    async execute() { return { status: "Success", signature, code: null, error: null,
      totalInputAmount: "1000000", totalOutputAmount: "10000000" }; },
    async markSubmitted() { return record("SUBMITTED"); },
    async readChain() { return { status: "PENDING" }; },
    async settle() { settled = true; return record("CONFIRMED"); },
  });
  assert.equal(result.status, "PENDING");
  assert.equal(settled, false);
});

test("ambiguous provider response never triggers an automatic second submit", async () => {
  let executions = 0;
  let unknown = false;
  const result = await executeManualBuyOnce(input(), {
    async assertSigned() {}, signature: () => signature,
    async claim() { return { claimed: true, record: record() }; },
    async execute() { executions += 1; throw new Error("timeout after provider may receive bytes"); },
    async markUncertain() { unknown = true; return record("UNKNOWN"); },
    async readChain() { return { status: "PENDING" }; },
  });
  assert.equal(result.status, "PENDING");
  assert.equal(executions, 1);
  assert.equal(unknown, true);
});

test("only finalized chain output becomes a confirmed amount", async () => {
  const result = await executeManualBuyOnce(input(), {
    async assertSigned() {}, signature: () => signature,
    async claim() { return { claimed: false, record: record("UNKNOWN") }; },
    async readChain() { return { status: "CONFIRMED", slot: 1,
      actualInputAmountRaw: "999999", actualOutputAmountRaw: "9000000", actualWalletNativeDebitLamportsRaw: "5000" }; },
    async settle() { return { ...record("CONFIRMED"), actualInputAmountRaw: "999999", actualOutputAmountRaw: "9000000", actualWalletNativeDebitLamportsRaw: "5000" }; },
    async execute() { throw new Error("duplicate may not submit"); },
  });
  assert.deepEqual(result, { status: "CONFIRMED", requestId: "jupiter-order-one", signature,
    actualInputAmountRaw: "999999", actualOutputAmountRaw: "9000000" });
});

test("a finalized output below the authorized floor never becomes a compliant BUY", async () => {
  let settled = false;
  const result = await executeManualBuyOnce(input(), {
    async assertSigned() {}, signature: () => signature,
    async claim() { return { claimed: false, record: record("UNKNOWN") }; },
    async readChain() { return { status: "CONFIRMED", slot: 1,
      actualInputAmountRaw: "999999", actualOutputAmountRaw: "7000000", actualWalletNativeDebitLamportsRaw: "5000" }; },
    async settle() { settled = true; return record("CONFIRMED"); },
    async execute() { throw new Error("duplicate may not submit"); },
  });
  assert.equal(result.status, "PENDING");
  assert.equal(settled, false);
});

test("missing instruction-effect limits stop before claiming or submitting", async () => {
  let claimed = false;
  await assert.rejects(executeManualBuyOnce({ ...input(), authorization: {
    ...authorization(), requiredMinimumOutputRaw: null,
  } }, {
    async claim() { claimed = true; return { claimed: true, record: record() }; },
  }), /transaction-effect/i);
  assert.equal(claimed, false);
});

test("wallet mismatch stops before a ledger claim or Jupiter call", async () => {
  let claimed = false;
  await assert.rejects(executeManualBuyOnce({ ...input(), walletAddress: "So11111111111111111111111111111111111111112" }, {
    async claim() { claimed = true; return { claimed: true, record: record() }; },
    async execute() { throw new Error("must not submit"); },
  }), /wallet/i);
  assert.equal(claimed, false);
});
