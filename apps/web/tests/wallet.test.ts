import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WalletControlView, walletErrorMessage } from "../components/wallet/wallet-button";
import { shortenAddress } from "../lib/solana/address";
import { authStatusForWallet, disconnectAfterSignOut, shouldClearMismatchedSession } from "../lib/auth/client-state";

const noop = async () => {};

function renderWallet(overrides: Partial<Parameters<typeof WalletControlView>[0]> = {}) {
  return renderToStaticMarkup(createElement(WalletControlView, {
    status: "disconnected",
    wallets: [],
    authStatus: "unauthenticated",
    onConnect: noop,
    onDisconnect: noop,
    onSignIn: noop,
    onSignOut: noop,
    ...overrides,
  }));
}

test("shortens wallet addresses without damaging short values", () => {
  assert.equal(shortenAddress("8Hx7abcdefghijk4pA2"), "8Hx7...4pA2");
  assert.equal(shortenAddress("1234567890"), "1234567890");
  assert.equal(shortenAddress("abcdef", 0), "abcdef");
});

test("renders a disconnected wallet selector without requiring a vendor", () => {
  const markup = renderWallet({ wallets: [{ id: "mock", name: "Test Wallet" }] });

  assert.match(markup, />Connect Wallet</);
  assert.match(markup, /Connect Test Wallet/);
  assert.match(markup, /does not sign a message or transaction/);
});

test("renders a useful no-wallet state", () => {
  const markup = renderWallet();

  assert.match(markup, /No compatible wallet found/);
  assert.match(markup, /Wallet Standard compatible Solana wallet/);
});

test("shows connected wallet identity, full address, and disconnect action", () => {
  const address = "8Hx7abcdefghijk4pA2";
  const markup = renderWallet({ status: "connected", address, walletName: "Test Wallet" });

  assert.match(markup, /8Hx7\.\.\.4pA2/);
  assert.match(markup, new RegExp(address));
  assert.match(markup, /Test Wallet/);
  assert.match(markup, /Not signed in/);
  assert.match(markup, /Sign in to StockPilot/);
  assert.match(markup, />Disconnect</);
  assert.match(markup, /does not authorize transactions or asset transfers/);
});

test("renders pending, authenticated, failure, and separate sign-out states", () => {
  const address = "8Hx7abcdefghijk4pA2";
  assert.match(
    renderWallet({ status: "connected", address, authStatus: "authenticating" }),
    /Waiting for signature…/,
  );

  const authenticated = renderWallet({
    status: "connected",
    address,
    authStatus: "authenticated",
    authWalletAddress: address,
  });
  assert.match(authenticated, /Signed in/);
  assert.match(authenticated, />Sign out</);
  assert.match(authenticated, />Disconnect</);

  const failed = renderWallet({
    status: "connected",
    address,
    authStatus: "error",
    authErrorMessage: "The wallet signature could not be verified.",
  });
  assert.match(failed, /The wallet signature could not be verified/);
  assert.match(failed, /Try signing in again/);
});

test("renders lifecycle labels and never leaks raw wallet errors", () => {
  assert.match(renderWallet({ status: "pending" }), /Checking wallet…/);
  assert.match(renderWallet({ status: "connecting" }), /Connecting…/);
  assert.match(renderWallet({ status: "disconnecting", address: "8Hx7abcdefghijk4pA2" }), /Disconnecting…/);
  assert.match(renderWallet({ status: "reconnecting", reconnectingAddress: "8Hx7abcdefghijk4pA2" }), /8Hx7\.\.\.4pA2/);
  assert.equal(walletErrorMessage("connect"), "We couldn't connect your wallet. Try again.");
  assert.equal(walletErrorMessage("disconnect"), "We couldn't disconnect your wallet. Try again.");
});

test("a wallet switch cannot inherit another wallet's session", () => {
  const walletA = "8Hx7abcdefghijk4pA2";
  const walletB = "9Jy8abcdefghijk5qB3";

  assert.equal(shouldClearMismatchedSession("connected", walletA, walletB), true);
  assert.equal(shouldClearMismatchedSession("connected", walletA, walletA), false);
  assert.equal(authStatusForWallet("authenticated", walletA, walletB), "loading");
  assert.equal(authStatusForWallet("authenticated", walletA, walletA), "authenticated");
});

test("disconnect clears the server session before disconnecting the wallet", async () => {
  const actions: string[] = [];
  await disconnectAfterSignOut(
    async () => { actions.push("sign-out"); },
    async () => { actions.push("disconnect"); },
  );
  assert.deepEqual(actions, ["sign-out", "disconnect"]);

  await assert.rejects(
    () => disconnectAfterSignOut(
      async () => { throw new Error("logout failed"); },
      async () => { actions.push("unsafe-disconnect"); },
    ),
    /logout failed/,
  );
  assert.doesNotMatch(actions.join(","), /unsafe-disconnect/);
});
