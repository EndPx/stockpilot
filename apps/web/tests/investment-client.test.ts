import assert from "node:assert/strict";
import test from "node:test";
import { classifyInvestmentApprovalError, InvestmentClientError, readInvestmentApiResponse, runInvestmentApproval } from "../lib/investments/client";
import type { InvestmentExecutionResponse, PreparedInvestmentResponse } from "../lib/investments/types";

const wallet = "wallet-one";

test("client only accepts an explicit not-submitted marker; generic errors stay ambiguous", async () => {
  for (const marker of [undefined, "UNKNOWN", "NOT_SUBMITTED"]) {
    await assert.rejects(readInvestmentApiResponse(new Response(JSON.stringify({ error: {
      code: "INVESTMENT_TOKEN_EXPIRED", message: "Expired", submissionStatus: marker,
    } }), { status: 409 })), (error: unknown) => error instanceof InvestmentClientError &&
      error.submissionStatus === (marker === "NOT_SUBMITTED" ? "NOT_SUBMITTED" : undefined));
  }
});
const prepared: PreparedInvestmentResponse = {
  investment: {
    walletAddress: wallet,
    providerRequestId: "order-one",
    asset: { symbol: "SPACEX", name: "SpaceX", mintAddress: "mint" },
    fundingAsset: { symbol: "USDC", mintAddress: "usdc" },
    inputAmountRaw: "1000000",
    inputAmountUsd: "1",
    outputAmountRaw: "1",
    estimatedOutputAmount: "0.1",
    requiredMinimumOutputRaw: "1",
    minimumOutputAmount: "0.1",
    maximumWalletNativeDebitLamportsRaw: "300000",
    router: "metis",
    mode: "ultra",
    feeBps: null,
    feeMint: null,
    priceImpactPct: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  transaction: "AQID",
  investmentToken: "token",
};
const result: InvestmentExecutionResponse = {
  execution: {
    status: "CONFIRMED",
    side: "BUY",
    providerRequestId: "order-one",
    transactionSignature: "signature",
    actualInputAmountRaw: "1000000",
    actualOutputAmountRaw: "1",
    solscanUrl: "https://solscan.io/tx/signature",
  },
};

test("wallet rejection never calls execute or portfolio refresh", async () => {
  let executions = 0;
  let refreshes = 0;
  await assert.rejects(runInvestmentApproval({
    prepared,
    connectedWalletAddress: wallet,
    sessionWalletAddress: wallet,
    async sign() { throw Object.assign(new Error("rejected"), { code: 4001 }); },
    async execute() { executions += 1; return result; },
    async refreshPortfolio() { refreshes += 1; },
  }), /rejected/);
  assert.equal(executions, 0);
  assert.equal(refreshes, 0);
});

test("wallet cancellation is classified as a rejection only before signing", () => {
  const cancellation = Object.assign(new Error("cancelled"), { code: 4001 });
  assert.equal(classifyInvestmentApprovalError(cancellation, false), "wallet-rejected");
  assert.equal(classifyInvestmentApprovalError(cancellation, true), "status-unknown");
});

test("a post-signing AbortError keeps the transaction outcome unknown", async () => {
  let signed = false;
  let failure: unknown;
  try {
    await runInvestmentApproval({
      prepared,
      connectedWalletAddress: wallet,
      sessionWalletAddress: wallet,
      async sign(bytes) { return bytes; },
      async execute() { throw Object.assign(new Error("response interrupted"), { name: "AbortError" }); },
      async refreshPortfolio() { throw new Error("portfolio must not refresh"); },
      onSigned() { signed = true; },
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(signed, true);
  assert.equal(classifyInvestmentApprovalError(failure, signed), "status-unknown");
});

test("wallet mismatch fails before opening a signature request", async () => {
  let signatures = 0;
  await assert.rejects(runInvestmentApproval({
    prepared,
    connectedWalletAddress: "wallet-two",
    sessionWalletAddress: wallet,
    async sign(bytes) { signatures += 1; return bytes; },
    async execute() { return result; },
    async refreshPortfolio() {},
  }), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "WALLET_MISMATCH");
  assert.equal(signatures, 0);
});

test("success submits the wallet-signed bytes and refetches blockchain portfolio", async () => {
  const steps: string[] = [];
  const output = await runInvestmentApproval({
    prepared,
    connectedWalletAddress: wallet,
    sessionWalletAddress: wallet,
    async sign(bytes) {
      steps.push(`sign:${[...bytes].join(",")}`);
      return new Uint8Array([4, 5, 6]);
    },
    async execute(signed, token) {
      steps.push(`execute:${signed}:${token}`);
      return result;
    },
    async refreshPortfolio() { steps.push("refresh"); },
    onSigned() { steps.push("signed"); },
  });
  assert.equal(output, result);
  assert.deepEqual(steps, ["sign:1,2,3", "signed", "execute:BAUG:token", "refresh"]);
});

test("a post-confirmation portfolio read failure cannot turn confirmed execution into failure", async () => {
  let refreshError: unknown;
  const output = await runInvestmentApproval({
    prepared,
    connectedWalletAddress: wallet,
    sessionWalletAddress: wallet,
    async sign(bytes) { return bytes; },
    async execute() { return result; },
    async refreshPortfolio() { throw new Error("rpc unavailable"); },
    onPortfolioRefreshError(error) { refreshError = error; },
  });
  assert.equal(output, result);
  assert.match(String(refreshError), /rpc unavailable/);
});

test("pending submission never refreshes portfolio or claims confirmation", async () => {
  let refreshes = 0;
  const output = await runInvestmentApproval({
    prepared,
    connectedWalletAddress: wallet,
    sessionWalletAddress: wallet,
    async sign(bytes) { return bytes; },
    async execute() { return { execution: { ...result.execution, status: "PENDING" } }; },
    async refreshPortfolio() { refreshes += 1; },
  });
  assert.equal(output.execution.status, "PENDING");
  assert.equal(refreshes, 0);
});

test("a chain-failed execution never refreshes portfolio as a purchase", async () => {
  let refreshes = 0;
  const output = await runInvestmentApproval({
    prepared,
    connectedWalletAddress: wallet,
    sessionWalletAddress: wallet,
    async sign(bytes) { return bytes; },
    async execute() { return { execution: { ...result.execution, status: "FAILED" } }; },
    async refreshPortfolio() { refreshes += 1; },
  });
  assert.equal(output.execution.status, "FAILED");
  assert.equal(refreshes, 0);
});
