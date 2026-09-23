import assert from "node:assert/strict";
import test from "node:test";
import { runInvestmentApproval } from "../lib/investments/client";
import { selectSessionWallet, signWithPrivyWallet } from "../lib/investments/privy-wallet";
import type { PreparedInvestmentResponse } from "../lib/investments/types";

test("the server session selects the matching Privy wallet, never the first wallet", () => {
  const external = { address: "external" };
  const primary = { address: "primary" };
  assert.equal(selectSessionWallet([external, primary], "primary"), primary);
  assert.equal(selectSessionWallet([external, primary], "unknown"), null);
  assert.equal(selectSessionWallet([primary, primary], "primary"), null);
});

test("Privy signs only the selected transaction and returns signed wire bytes", async () => {
  const wallet = { address: "primary" };
  const transaction = new Uint8Array(100);
  const signedTransaction = new Uint8Array(101);
  const signed = await signWithPrivyWallet({
    wallet,
    transaction,
    async signTransaction(input) {
      assert.equal(input.wallet, wallet);
      assert.equal(input.transaction, transaction);
      return { signedTransaction };
    },
  });
  assert.equal(signed, signedTransaction);
});

test("Privy raw signatures and malformed responses never reach execute", async () => {
  const wallet = { address: "primary" };
  for (const signedTransaction of [new Uint8Array(64), new Uint8Array(0), undefined]) {
    await assert.rejects(signWithPrivyWallet({
      wallet,
      transaction: new Uint8Array(100),
      async signTransaction() { return { signedTransaction: signedTransaction as Uint8Array }; },
    }), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "TRANSACTION_MISMATCH");
  }
});

test("a Privy wallet switch fails before signing or submitting", async () => {
  const prepared = {
    investment: {
      walletAddress: "session-wallet",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    transaction: "AQID",
    investmentToken: "token",
  } as PreparedInvestmentResponse;
  let signatures = 0;
  let executions = 0;
  await assert.rejects(runInvestmentApproval({
    prepared,
    connectedWalletAddress: "switched-wallet",
    sessionWalletAddress: "session-wallet",
    sign: async (transaction) => { signatures += 1; return transaction; },
    execute: async () => { executions += 1; throw new Error("must not submit"); },
    refreshPortfolio: async () => {},
  }), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "WALLET_MISMATCH");
  assert.equal(signatures, 0);
  assert.equal(executions, 0);
});
