import assert from "node:assert/strict";
import test from "node:test";
import { baselineSecurityHeaders, contentSecurityPolicy } from "../lib/security-headers";

test("production CSP restricts scripts to fresh nonces and denies framing", () => {
  const policy = contentSecurityPolicy("test-nonce", false);
  assert.match(policy, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic';/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /connect-src 'self';/);
  assert.match(policy, /form-action 'self'/);
  assert.match(contentSecurityPolicy("test-nonce", false, "https://stockpilot-test.authkit.app"),
    /form-action 'self' https:\/\/stockpilot-test\.authkit\.app;/);
  assert.match(contentSecurityPolicy("test-nonce", false, "https://evil.example/path?injected=1"),
    /form-action 'self';/);
  assert.match(policy, /base-uri 'none'/);
  assert.match(contentSecurityPolicy("development", true), /unsafe-eval/);
});

test("baseline security headers cover API responses as well as documents", () => {
  const headers = Object.fromEntries(baselineSecurityHeaders(true).map(({ key, value }) => [key, value]));
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000");
  assert.ok(!baselineSecurityHeaders(false).some(({ key }) => key === "Strict-Transport-Security"));
});

test("Privy CSP restricts mainnet RPC origins and SDK catalogue to its exact path", () => {
  const previous = process.env.NEXT_PUBLIC_AUTH_PROVIDER;
  process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";
  try {
    const policy = contentSecurityPolicy("test-nonce", false);
    const connect = policy.split("; ").find((directive) => directive.startsWith("connect-src "));
    assert.equal(connect, "connect-src 'self' https://auth.privy.io https://api.privy.io https://solana-mainnet.rpc.privy.systems wss://solana-mainnet.rpc.privy.systems https://explorer-api.walletconnect.com/v3/wallets");
    assert.doesNotMatch(connect!, /\*|relay|solana-devnet|\swss:\s/);
    assert.ok(!connect!.split(" ").includes("https://explorer-api.walletconnect.com"));
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_AUTH_PROVIDER;
    else process.env.NEXT_PUBLIC_AUTH_PROVIDER = previous;
  }
});
