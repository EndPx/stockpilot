import assert from "node:assert/strict";
import test from "node:test";
import {
  SOLANA_MAINNET_USDC_MINT,
  SPL_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@stockpilot/core/solana";
import {
  reconcileManualBuyOnChain,
  SolanaBuyReconciliationError,
  type ManualBuyReconciliationInput,
  type SolanaBuyReconciliationRpc,
} from "../lib/investments/reconciliation";

const signature = "1".repeat(88);
const wallet = "11111111111111111111111111111111";
const outputMint = "So11111111111111111111111111111111111111112";
const poolOwner = "Vote111111111111111111111111111111111111111";
const otherMint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const input: ManualBuyReconciliationInput = {
  signature, walletAddress: wallet, inputMint: SOLANA_MAINNET_USDC_MINT,
  outputMint, expectedInputAmountRaw: "1000000", requiredMinimumOutputRaw: "100000000",
  maximumWalletNativeDebitLamportsRaw: "2000000", outputDecimals: 9,
};

function balance(index: number, mint: string, owner: string, amount: string, decimals: number,
  programId = SPL_TOKEN_PROGRAM_ADDRESS) {
  return { accountIndex: index, mint, owner, programId,
    uiTokenAmount: { amount, decimals, uiAmount: 999999, uiAmountString: "untrusted" } };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    version: 0, slot: 42n,
    transaction: { signatures: [signature], message: {
      header: { numRequiredSignatures: 1 },
      accountKeys: [wallet, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", poolOwner],
    } },
    meta: {
      err: null,
      fee: 5_000n,
      loadedAddresses: { writable: ["SysvarRent111111111111111111111111111111111"], readonly: [] },
      preBalances: [10_000_000n, 2_000_000n, 2_000_000n, 0n],
      postBalances: [9_995_000n, 2_000_000n, 2_000_000n, 2_000_000n],
      preTokenBalances: [
        balance(1, SOLANA_MAINNET_USDC_MINT, wallet, "5000000", 6),
        balance(2, SOLANA_MAINNET_USDC_MINT, poolOwner, "10000000", 6),
      ],
      postTokenBalances: [
        balance(1, SOLANA_MAINNET_USDC_MINT, wallet, "4000000", 6),
        balance(2, SOLANA_MAINNET_USDC_MINT, poolOwner, "11000000", 6),
        balance(3, outputMint, wallet, "123456789", 9, TOKEN_2022_PROGRAM_ADDRESS),
      ],
    },
    ...overrides,
  };
}

function rpc(status: unknown = { value: [{ slot: 42, confirmationStatus: "finalized", err: null }] },
  tx: unknown = transaction(), calls: string[] = []): SolanaBuyReconciliationRpc {
  return {
    getSignatureStatuses(signatures, config) {
      assert.deepEqual(signatures, [signature]);
      assert.deepEqual(config, { searchTransactionHistory: true });
      calls.push("status");
      return { async send(options) { assert.ok(options?.abortSignal); return status; } };
    },
    getTransaction(value, config) {
      assert.equal(value, signature);
      assert.deepEqual(config, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 });
      calls.push("transaction");
      return { async send(options) { assert.ok(options?.abortSignal); return tx; } };
    },
  };
}

test("only finalized exact wallet USDC/output raw deltas confirm a manual BUY", async () => {
  const calls: string[] = [];
  const result = await reconcileManualBuyOnChain(input, rpc(
    { value: [{ slot: 42n, confirmationStatus: "finalized", err: null }] }, undefined, calls,
  ));
  assert.deepEqual(result, { status: "CONFIRMED", slot: 42,
    actualInputAmountRaw: "1000000", actualOutputAmountRaw: "123456789",
    actualWalletNativeDebitLamportsRaw: "5000" });
  assert.deepEqual(calls, ["status", "transaction"]);
});

test("only finalized token debit and wallet USDC credit confirm a manual SELL", async () => {
  const sell = { ...input, side: "SELL" as const, inputMint: outputMint,
    outputMint: SOLANA_MAINNET_USDC_MINT, inputDecimals: 9, outputDecimals: 6,
    expectedInputAmountRaw: "100000000", requiredMinimumOutputRaw: "1000000" };
  const base = transaction();
  const tx = transaction({ meta: { ...base.meta,
    preTokenBalances: [
      balance(1, outputMint, wallet, "500000000", 9, TOKEN_2022_PROGRAM_ADDRESS),
      balance(2, outputMint, poolOwner, "1000000000", 9, TOKEN_2022_PROGRAM_ADDRESS),
    ],
    postTokenBalances: [
      balance(1, outputMint, wallet, "400000000", 9, TOKEN_2022_PROGRAM_ADDRESS),
      balance(2, outputMint, poolOwner, "1100000000", 9, TOKEN_2022_PROGRAM_ADDRESS),
      balance(3, SOLANA_MAINNET_USDC_MINT, wallet, "1200000", 6),
    ],
  } });
  assert.deepEqual(await reconcileManualBuyOnChain(sell, rpc(undefined, tx)), {
    status: "CONFIRMED", slot: 42, actualInputAmountRaw: "100000000",
    actualOutputAmountRaw: "1200000", actualWalletNativeDebitLamportsRaw: "5000",
  });
  await assert.rejects(reconcileManualBuyOnChain({ ...sell, requiredMinimumOutputRaw: "1300000" }, rpc(undefined, tx)),
    SolanaBuyReconciliationError);
});

test("missing, merely confirmed, and unindexed transactions stay pending, never failed", async () => {
  const missingCalls: string[] = [];
  assert.deepEqual(await reconcileManualBuyOnChain(input, rpc({ value: [null] }, transaction(), missingCalls)),
    { status: "PENDING" });
  assert.deepEqual(missingCalls, ["status"]);
  const confirmedCalls: string[] = [];
  assert.deepEqual(await reconcileManualBuyOnChain(input, rpc({ value: [{ slot: 42,
    confirmationStatus: "confirmed", err: null }] }, transaction(), confirmedCalls)), { status: "PENDING" });
  assert.deepEqual(confirmedCalls, ["status"]);
  assert.deepEqual(await reconcileManualBuyOnChain(input, rpc(undefined, null)), { status: "PENDING" });
});

test("finalized chain failure is terminal only with matching transaction evidence", async () => {
  const chainError = { InstructionError: [1, "Custom"] };
  const result = await reconcileManualBuyOnChain(input, rpc(
    { value: [{ slot: 42, confirmationStatus: "finalized", err: chainError }] },
    transaction({ meta: { ...transaction().meta, err: chainError } }),
  ));
  assert.deepEqual(result, { status: "FAILED", slot: 42 });
  await assert.rejects(reconcileManualBuyOnChain(input, rpc(
    { value: [{ slot: 42, confirmationStatus: "finalized", err: chainError }] }, transaction(),
  )), SolanaBuyReconciliationError);
});

test("unrelated signature, wallet, mint, account identity, or extra wallet transfer cannot confirm", async () => {
  const good = transaction();
  const cases = [
    transaction({ transaction: { ...good.transaction, signatures: ["2".repeat(88)] } }),
    transaction({ transaction: { ...good.transaction, message: { ...good.transaction.message,
      accountKeys: [poolOwner, wallet, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"] } } }),
    transaction({ meta: { ...good.meta, postTokenBalances: good.meta.postTokenBalances.map((row) =>
      row.accountIndex === 3 ? { ...row, mint: otherMint } : row) } }),
    transaction({ meta: { ...good.meta, postTokenBalances: good.meta.postTokenBalances.map((row) =>
      row.accountIndex === 1 ? { ...row, owner: poolOwner } : row) } }),
    transaction({ meta: { ...good.meta, postTokenBalances: [...good.meta.postTokenBalances,
      balance(0, otherMint, wallet, "1", 9)] } }),
    transaction({ meta: { ...good.meta, preBalances: [10_000_000n, 2_000_000n, 2_000_000n, 2_000_000n] } }),
  ];
  for (const tx of cases) {
    await assert.rejects(reconcileManualBuyOnChain(input, rpc(undefined, tx)),
      (error: unknown) => error instanceof SolanaBuyReconciliationError &&
        error.message === "Solana could not verify this BUY transaction; keep it unresolved.");
  }
});

test("malformed or excessive raw movements and RPC failures never become false success", async () => {
  const good = transaction();
  const cases = [
    transaction({ meta: { ...good.meta, postTokenBalances: good.meta.postTokenBalances.map((row) =>
      row.accountIndex === 1 ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, amount: "3000000" } } : row) } }),
    transaction({ meta: { ...good.meta, postTokenBalances: good.meta.postTokenBalances.map((row) =>
      row.accountIndex === 3 ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, amount: "0" } } : row) } }),
    transaction({ meta: { ...good.meta, postTokenBalances: good.meta.postTokenBalances.map((row) =>
      row.accountIndex === 3 ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, amount: "99999999" } } : row) } }),
    transaction({ meta: { ...good.meta, postTokenBalances: good.meta.postTokenBalances.map((row) =>
      row.accountIndex === 3 ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, amount: "1.5" } } : row) } }),
    transaction({ meta: { ...good.meta, postTokenBalances: good.meta.postTokenBalances.map((row) =>
      row.accountIndex === 3 ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, decimals: 6 } } : row) } }),
    transaction({ meta: { ...good.meta,
      preTokenBalances: good.meta.preTokenBalances.map((row) => row.accountIndex === 2
        ? { ...row, owner: wallet } : row),
      postTokenBalances: good.meta.postTokenBalances.map((row) => row.accountIndex === 2
        ? { ...row, owner: wallet } : row.accountIndex === 1
          ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, amount: "3000000" } } : row),
    } }),
    transaction({ meta: { ...good.meta,
      preTokenBalances: good.meta.preTokenBalances.map((row) => row.accountIndex === 2
        ? balance(2, outputMint, wallet, "1000", 9) : row),
      postTokenBalances: good.meta.postTokenBalances.map((row) => row.accountIndex === 2
        ? balance(2, outputMint, wallet, "500", 9) : row),
    } }),
    transaction({ meta: { ...good.meta, preTokenBalances: null } }),
  ];
  for (const tx of cases) {
    await assert.rejects(reconcileManualBuyOnChain(input, rpc(undefined, tx)), SolanaBuyReconciliationError);
  }
  const failedRpc: SolanaBuyReconciliationRpc = {
    ...rpc(), getSignatureStatuses() { return { async send() { throw new Error("private RPC URL"); } }; },
  };
  await assert.rejects(reconcileManualBuyOnChain(input, failedRpc), (error: unknown) =>
    error instanceof SolanaBuyReconciliationError && !error.message.includes("private RPC URL"));
});

test("native SOL debit is bound to an explicit signed fee and rent cap", async () => {
  const good = transaction();
  const excessiveDrain = transaction({ meta: { ...good.meta,
    postBalances: [7_000_000n, 2_000_000n, 2_000_000n, 2_000_000n],
  } });
  await assert.rejects(reconcileManualBuyOnChain(input, rpc(undefined, excessiveDrain)),
    SolanaBuyReconciliationError);
  await assert.rejects(reconcileManualBuyOnChain(
    { ...input, maximumWalletNativeDebitLamportsRaw: "4000" }, rpc(),
  ), SolanaBuyReconciliationError);
  await assert.rejects(reconcileManualBuyOnChain(
    { ...input, maximumWalletNativeDebitLamportsRaw: "" }, rpc(),
  ), SolanaBuyReconciliationError);
  await assert.rejects(reconcileManualBuyOnChain(
    { ...input, maximumWalletNativeDebitLamportsRaw: "9".repeat(21) }, rpc(),
  ), SolanaBuyReconciliationError);
  await assert.rejects(reconcileManualBuyOnChain(
    { ...input, maximumWalletNativeDebitLamportsRaw: undefined as unknown as string }, rpc(),
  ), SolanaBuyReconciliationError);
  const nativeCreditOffset = transaction({ meta: { ...good.meta,
    postBalances: [9_997_000n, 2_000_000n, 2_000_000n, 2_000_000n],
  } });
  await assert.rejects(reconcileManualBuyOnChain(input, rpc(undefined, nativeCreditOffset)),
    SolanaBuyReconciliationError);
});

test("missing or malformed native balance and fee evidence cannot finalize", async () => {
  const good = transaction();
  const invalidEvidence = [
    { ...good.meta, preBalances: undefined },
    { ...good.meta, postBalances: undefined },
    { ...good.meta, preBalances: [10_000_000n] },
    { ...good.meta, postBalances: ["not-lamports", 2_000_000n, 2_000_000n, 2_000_000n] },
    { ...good.meta, fee: undefined },
    { ...good.meta, fee: -1n },
    { ...good.meta, fee: 3_000_000n },
  ];
  for (const meta of invalidEvidence) {
    await assert.rejects(reconcileManualBuyOnChain(input, rpc(undefined,
      transaction({ meta }))), SolanaBuyReconciliationError);
  }
  const chainError = { InstructionError: [1, "Custom"] };
  await assert.rejects(reconcileManualBuyOnChain(input, rpc(
    { value: [{ slot: 42, confirmationStatus: "finalized", err: chainError }] },
    transaction({ meta: { ...good.meta, err: chainError, fee: 3_000_000n } }),
  )), SolanaBuyReconciliationError);
});
