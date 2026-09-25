import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { notSubmittedTradeMessage, pollTradeStatus, readSellHolding, readTradeStatus, statusExecution, tradeStatusLabel } from "../lib/investments/trade-state";
import { InvestmentClientError } from "../lib/investments/client";
import type { ManualInvestmentStatusResponse } from "../lib/investments/types";

const wallet = "6EuMFHPtiyoFtsBTy1hiJpNgupP7qkZfZm9ErQ58ipsC";
const mint = "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP";
const position = { mintAddress: mint, quantity: "0.000646283", rawTokenAmount: "646283", decimals: 9, displayStatus: "RAW_DECIMALS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const portfolio = (positions: unknown = [position], walletAddress = wallet) => ({ portfolio: { walletAddress, positions } });
const execution = (status: ManualInvestmentStatusResponse["execution"]["status"]) => ({
  status, ledgerStatus: "SUBMITTED" as const, side: "BUY" as const, providerRequestId: "receipt-one",
  transactionSignature: "public-signature", actualInputAmountRaw: null, actualOutputAmountRaw: null,
  actualWalletNativeDebitLamportsRaw: null,
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("expired quote feedback has one next step, only behind the explicit not-submitted guard", () => {
  for (const code of ["JUPITER_ORDER_EXPIRED", "INVESTMENT_TOKEN_EXPIRED"]) {
    assert.equal(notSubmittedTradeMessage(new InvestmentClientError(code, "Expired. Prepare a new review.", "NOT_SUBMITTED")),
      "Quote expired. No transaction was sent. Review a new quote.");
  }
  const source = readFileSync(new URL("../components/demo-trade-form.tsx", import.meta.url), "utf8");
  assert.match(source, /cause.submissionStatus === "NOT_SUBMITTED"[\s\S]*?setError\(notSubmittedTradeMessage\(cause\)\)/);
});

test("SELL reads the exact Wallet holding, including small amounts and zero decimals", async () => {
  assert.deepEqual(await readSellHolding(json(portfolio()), wallet, mint), {
    amount: "0.000646283", displayAmount: "0.000646283", scaled: false,
  });
  const large = { ...position, rawTokenAmount: "18446744073709551615", decimals: 0 };
  assert.equal((await readSellHolding(json(portfolio([large])), wallet, mint)).amount, "18446744073709551615");
  assert.equal((await readSellHolding(json(portfolio([{ ...position, rawTokenAmount: "1" }])), wallet, mint)).amount, "0.000000001");
});

test("a verified empty portfolio is zero, but failed or malformed portfolio reads never become zero", async () => {
  assert.equal((await readSellHolding(json(portfolio([])), wallet, mint)).amount, "0");
  for (const status of [401, 429, 503]) {
    await assert.rejects(readSellHolding(json({ error: { message: "Unavailable" } }, status), wallet, mint));
  }
  for (const body of [null, {}, { portfolio: {} }, portfolio(null), portfolio([], "other-wallet"),
    portfolio([null]), portfolio([{ mintAddress: mint }]), portfolio([position, position]),
    portfolio([{ ...position, rawTokenAmount: "NaN" }]), portfolio([{ ...position, decimals: -1 }]),
    portfolio([{ ...position, rawTokenAmount: "18446744073709551616" }]),
    { portfolio: { ...portfolio([]).portfolio, unrecognizedTokenMintCount: 1 } }]) {
    await assert.rejects(readSellHolding(json(body), wallet, mint));
  }
});

test("scaled xStock display and SELL base units stay separate", async () => {
  const scaled = { ...position, quantity: "20", rawTokenAmount: "100000000", decimals: 8, displayStatus: "RPC_SCALED" };
  assert.deepEqual(await readSellHolding(json(portfolio([scaled])), wallet, mint), { amount: "1", displayAmount: "20", scaled: true });
  assert.deepEqual(await readSellHolding(json(portfolio([{ ...scaled, quantity: null, displayStatus: "MULTIPLIER_UNVERIFIED" }])), wallet, mint),
    { amount: "1", displayAmount: null, scaled: true });
});

test("receipt labels distinguish complete, confirming, failure and review without fake confirmation", () => {
  for (const state of ["CLAIMED", "SUBMITTED", "UNKNOWN"] as const) {
    assert.equal(statusExecution(execution(state)).status, "PENDING");
  }
  assert.equal(tradeStatusLabel("PENDING"), "Confirming on Solana…");
  assert.equal(tradeStatusLabel("CONFIRMED"), "Trade complete");
  assert.equal(statusExecution(execution("REVIEW_REQUIRED")).status, "REVIEW_REQUIRED");
  assert.match(tradeStatusLabel("REVIEW_REQUIRED"), /Do not resubmit/);
});

test("receipt reads reject missing, mismatched and malformed known receipts", async () => {
  for (const result of [null, {}, { execution: null }, { execution: { ...execution("CONFIRMED"), providerRequestId: "other" } },
    { execution: { ...execution("CONFIRMED"), status: "made-up-success" } }]) {
    await assert.rejects(readTradeStatus("receipt-one", new AbortController().signal, async () => json(result)));
  }
  assert.equal(await readTradeStatus(null, new AbortController().signal, async () => json({ execution: null })), null);
});

test("automatic confirmation polls only the receipt, pins its ID and stops on completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: unknown[] = [];
  const results: string[] = [];
  const stop = pollTradeStatus({ requestId: null,
    fetcher: async (url, init) => {
      assert.equal(url, "/api/investments/manual/status");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.cache, "no-store");
      calls.push(JSON.parse(String(init?.body)));
      return json({ execution: execution(calls.length === 1 ? "SUBMITTED" : "CONFIRMED") });
    }, onResult: (value) => results.push(value?.status ?? "EMPTY"), onError: () => assert.fail("unexpected error") });
  await flush();
  assert.deepEqual(results, ["PENDING"]);
  t.mock.timers.tick(5_000);
  await flush();
  assert.deepEqual(calls, [{ active: true }, { providerRequestId: "receipt-one" }]);
  assert.deepEqual(results, ["PENDING", "CONFIRMED"]);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(calls.length, 2);
  stop();
});

test("transient errors retry receipt reads with backoff, never unlocking a missing known trade", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let errors = 0;
  const results: string[] = [];
  const stop = pollTradeStatus({ requestId: "receipt-one", fetcher: async () => {
    calls++;
    if (calls === 1) return json({ error: { message: "not found" } }, 404);
    if (calls === 2) throw new Error("Network");
    return json({ execution: execution("CONFIRMED") });
  }, onResult: (value) => results.push(value?.status ?? "EMPTY"), onError: () => { errors++; } });
  await flush();
  assert.deepEqual(results, []);
  t.mock.timers.tick(5_000);
  await flush();
  t.mock.timers.tick(9_999);
  assert.equal(calls, 2);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(errors, 2);
  assert.deepEqual(results, ["CONFIRMED"]);
  stop();
});

test("automatic checking stops for every terminal or review-required result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const status of ["CONFIRMED", "FAILED", "REJECTED", "REVIEW_REQUIRED"] as const) {
    let calls = 0;
    const stop = pollTradeStatus({ requestId: "receipt-one", fetcher: async () => {
      calls++; return json({ execution: execution(status) });
    }, onResult: (value) => assert.equal(value?.status, status), onError: () => assert.fail() });
    await flush();
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls, 1);
    stop();
  }
});

test("slow checks do not overlap and unmount aborts without late callbacks or more requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let aborted = false;
  let complete!: (response: Response) => void;
  const stop = pollTradeStatus({ requestId: "receipt-one", fetcher: async (_url, init) => {
    calls++;
    init?.signal?.addEventListener("abort", () => { aborted = true; });
    return new Promise<Response>((resolve) => { complete = resolve; });
  }, onResult: () => assert.fail("late result"), onError: () => assert.fail("late error") });
  t.mock.timers.tick(10_000);
  assert.equal(calls, 1);
  stop();
  assert.equal(aborted, true);
  complete(json({ execution: execution("CONFIRMED") }));
  await flush();
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
});

test("a stuck status request times out, then retries only its receipt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let errors = 0;
  const stop = pollTradeStatus({ requestId: "receipt-one", fetcher: async (_url, init) => {
    calls++;
    if (calls > 1) return json({ execution: execution("CONFIRMED") });
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("Timeout"))));
  }, onResult: (value) => assert.equal(value?.status, "CONFIRMED"), onError: () => { errors++; } });
  t.mock.timers.tick(20_000);
  await flush();
  assert.equal(errors, 1);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal(calls, 2);
  stop();
});

test("trade form removes manual status action and old test-wallet footer, refreshing Sell on side/focus/settlement", () => {
  const source = readFileSync(new URL("../components/demo-trade-form.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Check trade status<|Pending verification|No order is sent until|0\.003 SOL/);
  assert.match(source, /pollTradeStatus/);
  assert.match(source, /walletAddress, side, execution\?\.status/);
  assert.match(source, /addEventListener\("focus", refreshVisible\)/);
  assert.match(source, /removeEventListener\("focus", refreshVisible\)/);
  assert.match(source, /setAmount\(held.amount\)/);
  assert.match(source, /holdingState !== "ready"/);
});
