import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNativeBalance,
  normalizeTokenAccounts,
  SolanaBalanceReadError,
  SolanaRpcReadAdapter,
  type SolanaPortfolioRpc,
} from "../lib/solana/read-adapter";
import {
  SPL_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@stockpilot/core/solana";

const wallet = "11111111111111111111111111111111";
const legacyMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const token2022Mint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";

function parsedAccount(mint: string, amount: string, decimals: number) {
  return {
    account: {
      data: {
        parsed: {
          type: "account",
          info: {
            mint,
            tokenAmount: { amount, decimals, uiAmount: null, uiAmountString: "ignored" },
          },
        },
      },
    },
  };
}

test("normalizes legacy and Token-2022 parsed accounts from raw amounts", () => {
  assert.deepEqual(normalizeTokenAccounts([
    parsedAccount(legacyMint, "200000000", 6),
  ], "spl-token"), [{
    mintAddress: legacyMint,
    rawAmount: "200000000",
    decimals: 6,
    amount: "200",
    program: "spl-token",
  }]);
  assert.deepEqual(normalizeTokenAccounts([
    parsedAccount(token2022Mint, "400000000", 9),
  ], "token-2022"), [{
    mintAddress: token2022Mint,
    rawAmount: "400000000",
    decimals: 9,
    amount: "0.4",
    program: "token-2022",
  }]);
});

test("normalizes native lamports with bigint-safe SOL formatting", () => {
  assert.deepEqual(normalizeNativeBalance(420_000_000n), {
    rawLamports: "420000000",
    amount: "0.42",
  });
  assert.deepEqual(normalizeNativeBalance(9_007_199_254_740_993n), {
    rawLamports: "9007199254740993",
    amount: "9007199.254740993",
  });
});

test("queries both token programs once and keeps their program identity", async () => {
  const filters: string[] = [];
  const rpc: SolanaPortfolioRpc = {
    getBalance() {
      return { async send() { return { value: 420_000_000n }; } };
    },
    getTokenAccountsByOwner(_owner, filter) {
      const programId = String(filter.programId);
      filters.push(programId);
      const account = programId === SPL_TOKEN_PROGRAM_ADDRESS
        ? parsedAccount(legacyMint, "1000000", 6)
        : parsedAccount(token2022Mint, "1", 0);
      return { async send() { return { value: [account] }; } };
    },
  };
  const adapter = new SolanaRpcReadAdapter(rpc);
  const [native, tokens] = await Promise.all([
    adapter.getNativeBalance(wallet),
    adapter.getTokenBalances(wallet),
  ]);
  assert.equal(native.amount, "0.42");
  assert.deepEqual(filters.sort(), [SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].sort());
  assert.deepEqual(tokens.map(({ program }) => program), ["spl-token", "token-2022"]);
});

test("malformed RPC data is an explicit read failure, never an empty balance", () => {
  assert.throws(
    () => normalizeTokenAccounts([{ account: { data: ["raw", "base64"] } }], "token-2022"),
    SolanaBalanceReadError,
  );
  assert.throws(() => normalizeTokenAccounts(null, "spl-token"), SolanaBalanceReadError);
  assert.throws(() => normalizeNativeBalance("0"), SolanaBalanceReadError);
});

test("RPC rejection is wrapped without leaking its message", async () => {
  const rpc: SolanaPortfolioRpc = {
    getBalance() {
      return { async send() { throw new Error("private endpoint secret"); } };
    },
    getTokenAccountsByOwner() {
      return { async send() { throw new Error("private endpoint secret"); } };
    },
  };
  const adapter = new SolanaRpcReadAdapter(rpc);
  await assert.rejects(adapter.getNativeBalance(wallet), {
    name: "SolanaBalanceReadError",
    message: "Solana RPC balance read failed.",
  });
  await assert.rejects(adapter.getTokenBalances(wallet), {
    name: "SolanaBalanceReadError",
    message: "Solana RPC balance read failed.",
  });
});
