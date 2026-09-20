import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WalletControlView, walletErrorMessage } from "../components/wallet/wallet-button";
import { shortenAddress } from "../lib/solana/address";

const noop = async () => {};

function renderWallet(overrides: Partial<Parameters<typeof WalletControlView>[0]> = {}) {
  return renderToStaticMarkup(createElement(WalletControlView, {
    status: "disconnected",
    wallets: [],
    onConnect: noop,
    onDisconnect: noop,
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
  assert.match(markup, />Disconnect</);
  assert.match(markup, /does not sign you in or authorize transactions/);
});

test("renders lifecycle labels and never leaks raw wallet errors", () => {
  assert.match(renderWallet({ status: "pending" }), /Checking wallet…/);
  assert.match(renderWallet({ status: "connecting" }), /Connecting…/);
  assert.match(renderWallet({ status: "disconnecting", address: "8Hx7abcdefghijk4pA2" }), /Disconnecting…/);
  assert.match(renderWallet({ status: "reconnecting", reconnectingAddress: "8Hx7abcdefghijk4pA2" }), /8Hx7\.\.\.4pA2/);
  assert.equal(walletErrorMessage("connect"), "We couldn't connect your wallet. Try again.");
  assert.equal(walletErrorMessage("disconnect"), "We couldn't disconnect your wallet. Try again.");
});
