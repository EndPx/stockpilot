import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNativeBalance,
  normalizeTokenAccounts,
  isVerifiedScaledUiMint,
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

function parsedAccount(mint: string, amount: string, decimals: number, uiAmountString = "ignored") {
  return {
    account: {
      data: {
        parsed: {
          type: "account",
          info: {
            mint,
            tokenAmount: { amount, decimals, uiAmount: null, uiAmountString },
          },
        },
      },
    },
  };
}

function parsedScaledMint(decimals = 9) {
  return {
    owner: TOKEN_2022_PROGRAM_ADDRESS,
    data: { program: "spl-token-2022", parsed: { type: "mint", info: {
      decimals, isInitialized: true,
      extensions: [{ extension: "scaledUiAmountConfig", state: {
        multiplier: "2", newMultiplier: "2", newMultiplierEffectiveTimestamp: 0,
      } }],
    } } },
  };
}

function rpc(overrides: Partial<SolanaPortfolioRpc> = {}): SolanaPortfolioRpc {
  return {
    getBalance() { return { async send() { return { value: 420_000_000n }; } }; },
    getTokenAccountsByOwner() { return { async send() { return { value: [] }; } }; },
    getAccountInfo() { return { async send() { return { context: { slot: 100n }, value: parsedScaledMint() }; } }; },
    getTokenSupply() { return { async send() { return { value: { decimals: 9 } }; } }; },
    getBlockHeight() { return { async send() { return 123n; } }; },
    ...overrides,
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

test("retains a same-context Token-2022 RPC UI string without treating it as raw units", () => {
  const [balance] = normalizeTokenAccounts([parsedAccount(token2022Mint, "1000000000", 9, "2")], "token-2022", 100n);
  assert.equal(balance.amount, "1");
  assert.equal(balance.rawAmount, "1000000000");
  assert.equal(balance.rpcUiAmountString, "2");
  assert.equal(balance.contextSlot, 100n);
  assert.equal(normalizeTokenAccounts([parsedAccount(token2022Mint, "1000000000", 9, "2")], "token-2022")[0].rpcUiAmountString, undefined);
});

test("recognizes only a parsed Token-2022 mint with Scaled UI extension and matching decimals", () => {
  const mint = parsedScaledMint();
  assert.equal(isVerifiedScaledUiMint(mint, 9), true);
  assert.equal(isVerifiedScaledUiMint(mint, 6), false);
  assert.equal(isVerifiedScaledUiMint({ ...mint, owner: SPL_TOKEN_PROGRAM_ADDRESS }, 9), false);
  assert.equal(isVerifiedScaledUiMint({ ...mint, data: { ...mint.data, parsed: { ...mint.data.parsed,
    info: { ...mint.data.parsed.info, extensions: [] } } } }, 9), false);
});

test("rejects malformed Scaled UI multipliers and effective timestamps", () => {
  const mint = parsedScaledMint(8);
  const withState = (state: Record<string, unknown>) => ({
    ...mint, data: { ...mint.data, parsed: { ...mint.data.parsed, info: {
      ...mint.data.parsed.info,
      extensions: [{ extension: "scaledUiAmountConfig", state }],
    } } },
  });
  assert.equal(isVerifiedScaledUiMint(withState({ multiplier: "1.0026642075893797",
    newMultiplier: "1.0032690125398187", newMultiplierEffectiveTimestamp: 1_786_149_000 }), 8), true);
  for (const state of [
    { multiplier: "0", newMultiplier: "1", newMultiplierEffectiveTimestamp: 0 },
    { multiplier: "NaN", newMultiplier: "1", newMultiplierEffectiveTimestamp: 0 },
    { multiplier: "1", newMultiplier: "Infinity", newMultiplierEffectiveTimestamp: 0 },
    { multiplier: "1", newMultiplier: "1", newMultiplierEffectiveTimestamp: "not-a-timestamp" },
    { multiplier: "1", newMultiplier: "1", newMultiplierEffectiveTimestamp: "9223372036854775808" },
  ]) {
    assert.equal(isVerifiedScaledUiMint(withState(state), 8), false);
  }
});

test("mint verification requires an RPC slot at or after the token-account snapshot", async () => {
  const adapter = new SolanaRpcReadAdapter(rpc({
    getAccountInfo(_mint, config) {
      assert.equal(config.minContextSlot, 100n);
      return { async send() { return { context: { slot: 99n }, value: parsedScaledMint() }; } };
    },
  }));
  assert.equal(await adapter.verifyScaledUiMint(token2022Mint, 9, 100n), false);
  assert.equal(await new SolanaRpcReadAdapter(rpc()).verifyScaledUiMint(token2022Mint, 9, 100n), true);
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
  const rpcClient = rpc({
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
  });
  const adapter = new SolanaRpcReadAdapter(rpcClient);
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
  const rpcClient = rpc({
    getBalance() {
      return { async send() { throw new Error("private endpoint secret"); } };
    },
    getTokenAccountsByOwner() {
      return { async send() { throw new Error("private endpoint secret"); } };
    },
  });
  const adapter = new SolanaRpcReadAdapter(rpcClient);
  await assert.rejects(adapter.getNativeBalance(wallet), {
    name: "SolanaBalanceReadError",
    message: "Solana RPC balance read failed.",
  });
  await assert.rejects(adapter.getTokenBalances(wallet), {
    name: "SolanaBalanceReadError",
    message: "Solana RPC balance read failed.",
  });
});

test("reads output mint decimals and current block height for investment validity", async () => {
  const adapter = new SolanaRpcReadAdapter(rpc());
  assert.equal(await adapter.getTokenDecimals(token2022Mint), 9);
  assert.equal(await adapter.getCurrentBlockHeight(), 123n);
});

test("invalid investment RPC values fail closed", async () => {
  const invalidDecimals = new SolanaRpcReadAdapter(rpc({
    getTokenSupply() { return { async send() { return { value: { decimals: -1 } }; } }; },
  }));
  const invalidHeight = new SolanaRpcReadAdapter(rpc({
    getBlockHeight() { return { async send() { return -1n; } }; },
  }));
  await assert.rejects(invalidDecimals.getTokenDecimals(token2022Mint), { name: "SolanaInvestmentReadError" });
  await assert.rejects(invalidHeight.getCurrentBlockHeight(), { name: "SolanaInvestmentReadError" });
});
