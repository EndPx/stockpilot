import assert from "node:assert/strict";
import test from "node:test";
import { runInvestmentApproval } from "../lib/investments/client";
import type { InvestmentExecutionResponse, PreparedInvestmentResponse } from "../lib/investments/types";

const wallet = "wallet-one";
const prepared: PreparedInvestmentResponse = {
  investment: {
    walletAddress: wallet,
    asset: { symbol: "SPACEX", name: "SpaceX", mintAddress: "mint" },
    fundingAsset: { symbol: "USDC", mintAddress: "usdc" },
    inputAmountRaw: "1000000",
    inputAmountUsd: "1",
    outputAmountRaw: "1",
    estimatedOutputAmount: "0.1",
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
    status: "success",
    symbol: "SPACEX",
    signature: "signature",
    inputAmountRaw: "1000000",
    inputAmountUsd: "1",
    outputAmountRaw: "1",
    outputAmount: "0.1",
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
