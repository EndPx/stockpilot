import { createSolanaReadAdapter, getSolanaRpcUrl } from "../lib/solana/read-adapter";

// A public, well-known program address avoids committing or reading a personal wallet.
const VALIDATION_OWNER = "SysvarRent111111111111111111111111111111111";

const adapter = createSolanaReadAdapter();
const [nativeBalance, tokenBalances] = await Promise.all([
  adapter.getNativeBalance(VALIDATION_OWNER),
  adapter.getTokenBalances(VALIDATION_OWNER),
]);

if (!/^\d+$/.test(nativeBalance.rawLamports) || !/^\d+(?:\.\d+)?$/.test(nativeBalance.amount)) {
  throw new Error("Solana RPC returned a malformed native balance.");
}
for (const balance of tokenBalances) {
  if (!/^\d+$/.test(balance.rawAmount) || !/^\d+(?:\.\d+)?$/.test(balance.amount)) {
    throw new Error(`Solana RPC returned a malformed ${balance.program} token balance.`);
  }
}

const rpcOrigin = new URL(getSolanaRpcUrl()).origin;
console.log(
  `Portfolio RPC read passed against ${rpcOrigin}: native balance decoded; ` +
  `${tokenBalances.length} legacy SPL/Token-2022 account(s) decoded.`,
);
