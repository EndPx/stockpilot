import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPrivyClientConfig } from "../lib/privy/client-config";

test("Privy embedded signing has explicit mainnet RPC and subscriptions", () => {
  const config = createPrivyClientConfig("public-test-app");
  assert.deepEqual(Object.keys(config.solana?.rpcs ?? {}), ["solana:mainnet"]);
  const mainnet = config.solana?.rpcs?.["solana:mainnet"];
  assert.ok(mainnet);
  assert.equal(typeof mainnet.rpc.getLatestBlockhash, "function");
  assert.equal(typeof mainnet.rpc.getFeeForMessage, "function");
  assert.equal(typeof mainnet.rpcSubscriptions.signatureNotifications, "function");
  assert.equal(mainnet.blockExplorerUrl, "https://explorer.solana.com?cluster=mainnet");
});

test("Privy browser RPC uses only the encoded public app ID and is lazy", async (t) => {
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new URL(input instanceof Request ? input.url : String(input)));
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.method, "getSlot");
    return Response.json({ jsonrpc: "2.0", id: payload.id, result: 7 });
  });
  const config = createPrivyClientConfig("public-app +&test");
  assert.equal(requests.length, 0);
  const mainnet = config.solana?.rpcs?.["solana:mainnet"];
  assert.ok(mainnet);
  assert.equal(await mainnet.rpc.getSlot().send(), 7n);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.origin, "https://solana-mainnet.rpc.privy.systems");
  assert.deepEqual([...requests[0]!.searchParams], [["privyAppId", "public-app +&test"]]);
});

test("embedded login disables WalletConnect without deadlocking SDK connector readiness", () => {
  const config = createPrivyClientConfig("public-test-app");
  assert.deepEqual(config.loginMethods, ["google", "email"]);
  assert.equal(config.embeddedWallets?.solana?.createOnLogin, "users-without-wallets");
  assert.equal(config.externalWallets?.walletConnect?.enabled, false);
  assert.notEqual(config.externalWallets?.disableAllExternalWallets, true);
});

test("the mounted Privy provider uses the mainnet-aware client config", () => {
  const provider = readFileSync(new URL("../providers/privy-provider.tsx", import.meta.url), "utf8");
  assert.match(provider, /createPrivyClientConfig\(PRIVY_APP_ID\)/);
  assert.match(provider, /config=\{privyConfig\}/);
  const config = readFileSync(new URL("../lib/privy/client-config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config, /process\.env|PRIVY_APP_SECRET|SOLANA_RPC_URL/);
});
