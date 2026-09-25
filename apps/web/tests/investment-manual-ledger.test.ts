import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { SOLANA_MAINNET_USDC_MINT } from "@stockpilot/core/solana";
import {
  claimManualBuyExecution,
  getManualBuyExecution,
  getUnresolvedManualExecution,
  getRecoverableManualExecution,
  assertNoUnresolvedManualExecution,
  ManualBuyLedgerError,
  markManualBuySubmitted,
  markManualBuyUncertain,
  markManualTradeRejected,
  reconcileManualBuyExecution,
  type ManualBuyClaimInput,
} from "../lib/control-plane/manual-executions";

const sql = (await Promise.all([
  "0001_agent_control_plane.sql", "0002_agent_grants_and_oauth_connections.sql",
  "0003_idempotent_investment_requests.sql", "0004_manual_investment_executions.sql",
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")))).join("\n");

const accountId = "did:privy:manual-buyer";
const walletAddress = "11111111111111111111111111111111";
const outputMint = "So11111111111111111111111111111111111111112";
const signature = "1".repeat(88);
const claim = (overrides: Partial<ManualBuyClaimInput> = {}): ManualBuyClaimInput => ({
  accountId, walletAddress, providerRequestId: "jupiter-order-one",
  messageFingerprint: "a".repeat(43), transactionSignature: signature,
  inputMint: SOLANA_MAINNET_USDC_MINT, outputMint, outputDecimals: 9,
  inputAmountRaw: "1000000", requiredMinimumOutputRaw: "100000",
  maximumWalletNativeDebitLamportsRaw: "2000000",
  expiresAt: new Date(Date.now() + 120_000).toISOString(), ...overrides,
});

async function setup() {
  const db = await PGlite.create();
  await db.exec(sql);
  const store = {
    transaction: <T>(work: (client: { query: typeof db.query }) => Promise<T>) =>
      db.transaction((tx) => work({ query: tx.query.bind(tx) })),
    query: db.query.bind(db),
  };
  return { db, store };
}

test("preflight rejection releases the owner lock but the original signature is permanently single-use", async () => {
  const { db, store } = await setup();
  try {
    const input = claim();
    const key = { accountId, walletAddress, providerRequestId: input.providerRequestId, transactionSignature: signature };
    const first = await claimManualBuyExecution(input, store);
    const rejected = await markManualTradeRejected(key, store);
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.submittedAt, null);
    assert.ok(rejected.resolvedAt);
    assert.equal((await markManualTradeRejected(key, store)).id, first.record.id);
    assert.equal((await claimManualBuyExecution(input, store)).claimed, false);
    assert.equal(await getUnresolvedManualExecution({ accountId, walletAddress }, store), null);
    await assertNoUnresolvedManualExecution({ accountId, walletAddress }, store);
    await assert.rejects(markManualBuySubmitted(key, store));
    await assert.rejects(reconcileManualBuyExecution({ ...key, outcome: "FAILED" }, store));
    await assert.rejects(db.query("UPDATE control_manual_investment_executions SET status = 'UNKNOWN', resolved_at = NULL WHERE id = $1", [first.record.id]));
    await assert.rejects(claimManualBuyExecution(claim({ providerRequestId: "duplicate-signature" }), store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "IDEMPOTENCY_CONFLICT");
    assert.equal((await claimManualBuyExecution(claim({ providerRequestId: "new-reviewed-trade", transactionSignature: "2".repeat(88) }), store)).claimed, true);
    const events = await db.query<{ status: string }>("SELECT status FROM control_manual_execution_events WHERE execution_id = $1 ORDER BY created_at", [first.record.id]);
    assert.deepEqual(events.rows.map((row) => row.status), ["CLAIMED", "REJECTED"]);
  } finally { await db.close(); }
});

test("a submission with an ambiguous or accepted response cannot become a preflight rejection", async () => {
  for (const state of ["UNKNOWN", "SUBMITTED"] as const) {
    const { db, store } = await setup();
    try {
      const input = claim();
      const key = { accountId, walletAddress, providerRequestId: input.providerRequestId, transactionSignature: signature };
      await claimManualBuyExecution(input, store);
      await (state === "UNKNOWN" ? markManualBuyUncertain(key, store) : markManualBuySubmitted(key, store));
      await assert.rejects(markManualTradeRejected(key, store),
        (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_TRANSITION");
      assert.equal((await getManualBuyExecution(key, store))?.status, state);
    } finally { await db.close(); }
  }
});

test("manual BUY claim is durable, single-use, and bound to one exact transaction", async () => {
  const { db, store } = await setup();
  try {
    const input = claim();
    const first = await claimManualBuyExecution(input, store);
    assert.equal(first.claimed, true);
    assert.equal(first.record.status, "CLAIMED");
    assert.equal(first.record.walletAddress, walletAddress);
    assert.equal(first.record.outputDecimals, 9);
    assert.equal(first.record.requiredMinimumOutputRaw, "100000");
    assert.equal(first.record.maximumWalletNativeDebitLamportsRaw, "2000000");
    await assert.rejects(db.query(
      "UPDATE control_manual_investment_executions SET maximum_wallet_native_debit_lamports_raw = 3000000 WHERE id = $1",
      [first.record.id],
    ));
    await assert.rejects(db.query(
      "UPDATE control_manual_investment_executions SET required_minimum_output_raw = 1 WHERE id = $1",
      [first.record.id],
    ));
    await assert.rejects(db.query(
      "UPDATE control_manual_investment_executions SET output_decimals = 6 WHERE id = $1",
      [first.record.id],
    ));
    const repeated = await claimManualBuyExecution(input, store);
    assert.equal(repeated.claimed, false);
    assert.equal(repeated.record.id, first.record.id);
    for (const conflicting of [
      { inputAmountRaw: "2000000" }, { messageFingerprint: "b".repeat(43) },
      { transactionSignature: "2".repeat(88) }, { outputMint: "Vote111111111111111111111111111111111111111" },
      { outputDecimals: 6 }, { requiredMinimumOutputRaw: "100001" },
      { maximumWalletNativeDebitLamportsRaw: "2000001" },
    ]) {
      await assert.rejects(claimManualBuyExecution(claim({ ...conflicting, expiresAt: input.expiresAt }), store),
        (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "IDEMPOTENCY_CONFLICT");
    }
    const rows = await db.query<{ total: number }>("SELECT count(*)::integer AS total FROM control_manual_investment_executions");
    assert.equal(rows.rows[0].total, 1);
    const events = await db.query<{ status: string }>("SELECT status FROM control_manual_execution_events");
    assert.deepEqual(events.rows.map((event) => event.status), ["CLAIMED"]);
    // A second provider request cannot submit the same signed transaction.
    await assert.rejects(claimManualBuyExecution(claim({ providerRequestId: "jupiter-order-two" }), store));
    assert.equal((await getManualBuyExecution(input, store))?.id, first.record.id);
  } finally { await db.close(); }
});

test("manual SELL is a distinct immutable intent with token input and USDC output", async () => {
  const { db, store } = await setup();
  try {
    const sell = claim({ side: "SELL", inputMint: outputMint,
      outputMint: SOLANA_MAINNET_USDC_MINT, inputDecimals: 9, outputDecimals: 6,
      inputAmountRaw: "100000000", requiredMinimumOutputRaw: "1000000" });
    const first = await claimManualBuyExecution(sell, store);
    assert.equal(first.record.side, "SELL");
    assert.equal(first.record.inputDecimals, 9);
    assert.equal(first.record.outputMint, SOLANA_MAINNET_USDC_MINT);
    await assert.rejects(db.query("UPDATE control_manual_investment_executions SET side = 'BUY' WHERE id = $1", [first.record.id]));
    await assert.rejects(claimManualBuyExecution({ ...sell, side: "BUY" }, store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_INPUT");
    assert.equal((await claimManualBuyExecution(sell, store)).claimed, false);
  } finally { await db.close(); }
});

test("owner wallet binding and expiry fail closed before creating a claim", async () => {
  const { db, store } = await setup();
  try {
    await claimManualBuyExecution(claim(), store);
    await assert.rejects(claimManualBuyExecution(claim({
      providerRequestId: "another-order", transactionSignature: "2".repeat(88),
      walletAddress: "So11111111111111111111111111111111111111112",
    }), store), (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "WALLET_BINDING_MISMATCH");
    await assert.rejects(claimManualBuyExecution(claim({
      providerRequestId: "expired-order", transactionSignature: "2".repeat(88),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    }), store), (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "ORDER_EXPIRED");
    await assert.rejects(claimManualBuyExecution(claim({ inputMint: outputMint }), store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_INPUT");
    for (const invalid of [
      { outputDecimals: -1 }, { outputDecimals: 256 },
      { requiredMinimumOutputRaw: "0" }, { maximumWalletNativeDebitLamportsRaw: "0" },
      { maximumWalletNativeDebitLamportsRaw: "9".repeat(21) },
    ]) {
      await assert.rejects(claimManualBuyExecution(claim(invalid), store),
        (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_INPUT");
    }
    assert.equal(await getManualBuyExecution({ accountId: "did:privy:another", walletAddress,
      providerRequestId: "jupiter-order-one" }, store), null);
    assert.equal((await db.query<{ total: number }>("SELECT count(*)::integer AS total FROM control_manual_investment_executions")).rows[0].total, 1);
  } finally { await db.close(); }
});

test("one unresolved trade blocks another order and is recoverable by verified owner", async () => {
  const { db, store } = await setup();
  try {
    const first = claim();
    const claimed = await claimManualBuyExecution(first, store);
    assert.equal((await getUnresolvedManualExecution({ accountId, walletAddress }, store))?.id, claimed.record.id);
    await assert.rejects(assertNoUnresolvedManualExecution({ accountId, walletAddress }, store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "UNRESOLVED_TRADE");
    const second = claim({ providerRequestId: "another-order", transactionSignature: "2".repeat(88) });
    await assert.rejects(claimManualBuyExecution(second, store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "UNRESOLVED_TRADE");
    assert.equal(await getUnresolvedManualExecution({ accountId: "did:privy:another", walletAddress }, store), null);
    await reconcileManualBuyExecution({ accountId, walletAddress, providerRequestId: first.providerRequestId,
      transactionSignature: first.transactionSignature, outcome: "FAILED" }, store);
    await assertNoUnresolvedManualExecution({ accountId, walletAddress }, store);
    assert.equal(await getUnresolvedManualExecution({ accountId, walletAddress }, store), null);
    assert.equal((await getRecoverableManualExecution({ accountId, walletAddress }, store))?.status, "FAILED");
    await assert.rejects(claimManualBuyExecution(claim({ providerRequestId: "same-signature-again" }), store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "IDEMPOTENCY_CONFLICT");
    assert.equal((await claimManualBuyExecution(second, store)).claimed, true);
  } finally { await db.close(); }
});

test("uncertain submission cannot be claimed again and only reconciliation resolves it", async () => {
  const { db, store } = await setup();
  try {
    const input = claim();
    const key = { accountId: input.accountId, walletAddress: input.walletAddress,
      providerRequestId: input.providerRequestId, transactionSignature: input.transactionSignature };
    const first = await claimManualBuyExecution(input, store);
    assert.equal((await markManualBuyUncertain(key, store)).status, "UNKNOWN");
    assert.equal((await claimManualBuyExecution(input, store)).claimed, false);
    assert.equal((await markManualBuySubmitted(key, store)).status, "SUBMITTED");
    assert.equal((await markManualBuySubmitted(key, store)).status, "SUBMITTED");
    assert.equal((await markManualBuyUncertain(key, store)).status, "UNKNOWN");
    const confirmed = await reconcileManualBuyExecution({ ...key, outcome: "CONFIRMED",
      actualInputAmountRaw: "999999", actualOutputAmountRaw: "120000",
      actualWalletNativeDebitLamportsRaw: "5000" }, store);
    assert.equal(confirmed.id, first.record.id);
    assert.equal(confirmed.status, "CONFIRMED");
    assert.equal(confirmed.actualInputAmountRaw, "999999");
    assert.equal(confirmed.actualOutputAmountRaw, "120000");
    assert.equal(confirmed.actualWalletNativeDebitLamportsRaw, "5000");
    assert.ok(confirmed.submittedAt);
    assert.ok(confirmed.resolvedAt);
    assert.equal((await reconcileManualBuyExecution({ ...key, outcome: "CONFIRMED",
      actualInputAmountRaw: "999999", actualOutputAmountRaw: "120000",
      actualWalletNativeDebitLamportsRaw: "5000" }, store)).id, confirmed.id);
    await assert.rejects(markManualBuySubmitted(key, store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_TRANSITION");
    await assert.rejects(reconcileManualBuyExecution({ ...key, outcome: "FAILED" }, store),
      (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_TRANSITION");
    const events = await db.query<{ status: string }>("SELECT status FROM control_manual_execution_events ORDER BY created_at, id");
    assert.deepEqual(events.rows.map((event) => event.status), ["CLAIMED", "UNKNOWN", "SUBMITTED", "UNKNOWN", "CONFIRMED"]);
    await assert.rejects(db.query("UPDATE control_manual_investment_executions SET input_amount_raw = 2000000 WHERE id = $1", [confirmed.id]));
    await assert.rejects(db.query("UPDATE control_manual_investment_executions SET maximum_wallet_native_debit_lamports_raw = 3000000 WHERE id = $1", [confirmed.id]));
    await assert.rejects(db.query("UPDATE control_manual_investment_executions SET required_minimum_output_raw = 1 WHERE id = $1", [confirmed.id]));
    await assert.rejects(db.query("UPDATE control_manual_investment_executions SET output_decimals = 6 WHERE id = $1", [confirmed.id]));
    await assert.rejects(db.query("DELETE FROM control_manual_investment_executions WHERE id = $1", [confirmed.id]));
    await assert.rejects(db.query("DELETE FROM control_manual_execution_events WHERE execution_id = $1", [confirmed.id]));
  } finally { await db.close(); }
});

test("failed reconciliation is terminal; mismatched result and overspend are rejected", async () => {
  const { db, store } = await setup();
  try {
    const input = claim();
    const key = { accountId: input.accountId, walletAddress: input.walletAddress,
      providerRequestId: input.providerRequestId, transactionSignature: input.transactionSignature };
    await claimManualBuyExecution(input, store);
    await assert.rejects(db.query(
      `UPDATE control_manual_investment_executions
       SET status = 'CONFIRMED', submitted_at = now(), resolved_at = now(),
           actual_input_amount_raw = 1000000, actual_output_amount_raw = 120000
       WHERE account_id = $1 AND provider_request_id = $2`, [accountId, input.providerRequestId],
    ));
    await assert.rejects(db.query(
      `UPDATE control_manual_investment_executions
       SET status = 'CONFIRMED', submitted_at = now(), resolved_at = now(),
           actual_input_amount_raw = 1000000, actual_output_amount_raw = 120000,
           actual_wallet_native_debit_lamports_raw = 2000001
       WHERE account_id = $1 AND provider_request_id = $2`, [accountId, input.providerRequestId],
    ));
    await assert.rejects(reconcileManualBuyExecution({ ...key, outcome: "CONFIRMED",
      actualInputAmountRaw: "1000001", actualOutputAmountRaw: "120000",
      actualWalletNativeDebitLamportsRaw: "5000" }, store),
    (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_INPUT");
    await assert.rejects(reconcileManualBuyExecution({ ...key, outcome: "CONFIRMED",
      actualInputAmountRaw: "1000000", actualOutputAmountRaw: "99999",
      actualWalletNativeDebitLamportsRaw: "5000" }, store),
    (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_INPUT");
    await assert.rejects(reconcileManualBuyExecution({ ...key, outcome: "CONFIRMED",
      actualInputAmountRaw: "1000000", actualOutputAmountRaw: "120000",
      actualWalletNativeDebitLamportsRaw: "2000001" }, store),
    (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_INPUT");
    const failed = await reconcileManualBuyExecution({ ...key, outcome: "FAILED" }, store);
    assert.equal(failed.status, "FAILED");
    assert.equal((await reconcileManualBuyExecution({ ...key, outcome: "FAILED" }, store)).id, failed.id);
    await assert.rejects(reconcileManualBuyExecution({ ...key, outcome: "CONFIRMED",
      actualInputAmountRaw: "1000000", actualOutputAmountRaw: "120000",
      actualWalletNativeDebitLamportsRaw: "5000" }, store),
    (error: unknown) => error instanceof ManualBuyLedgerError && error.code === "INVALID_TRANSITION");
    await assert.rejects(db.query("UPDATE control_manual_investment_executions SET status = 'CLAIMED' WHERE id = $1", [failed.id]));
  } finally { await db.close(); }
});
