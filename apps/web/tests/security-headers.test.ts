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
