import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrivyWalletCard } from "../components/privy/privy-wallet-card";
import { ThemeToggle } from "../components/theme-toggle";

test("compact overview wallet shows only verified public identity and safe actions", () => {
  const html = renderToStaticMarkup(createElement(PrivyWalletCard, {
    address: "6EuMFHPtiyoFtsBTy1hiJpNgupP7qKzfZm9ErQ58ipsC",
    compact: true,
  }));
  assert.match(html, /Public Solana address/);
  assert.match(html, /6EuMFHPtiyoFtsBTy1hiJpNgupP7qKzfZm9ErQ58ipsC/);
  assert.match(html, /Copy address/);
  assert.match(html, /solscan\.io\/account/);
  assert.doesNotMatch(html, /Created through Privy|private key|Phantom/i);
});

test("theme control starts from the documented dark default with an accessible action", () => {
  const html = renderToStaticMarkup(createElement(ThemeToggle));
  assert.match(html, /aria-label="Switch to light mode"/);
  assert.match(html, /Light mode/);
});
