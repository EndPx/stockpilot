import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_CHALLENGE_TTL_MS, AUTH_SESSION_TTL_MS, assertSameOrigin, getAuthRuntimeConfig } from "../lib/auth/config";
import { createAuthChallenge, decodeAuthChallenge, encodeAuthChallenge } from "../lib/auth/challenge";
import { AuthError } from "../lib/auth/errors";
import { createAuthSession, decodeAuthSession, encodeAuthSession } from "../lib/auth/session";

const secret = "test-secret-with-at-least-thirty-two-bytes";
const walletAddress = "11111111111111111111111111111111";
const config = getAuthRuntimeConfig({
  APP_URL: "https://stockpilot.example",
  SESSION_SECRET: secret,
  NODE_ENV: "test",
});

test("builds a complete five-minute SIWS challenge", () => {
  const now = Date.parse("2026-09-21T00:00:00.000Z");
  const challenge = createAuthChallenge(walletAddress, config, now);

  assert.equal(challenge.input.domain, "stockpilot.example");
  assert.equal(challenge.input.uri, "https://stockpilot.example");
  assert.equal(challenge.input.address, walletAddress);
  assert.equal(challenge.input.chainId, "solana:mainnet");
  assert.equal(challenge.input.version, "1");
  assert.equal(challenge.input.nonce.length, 32);
  assert.equal(challenge.input.issuedAt, "2026-09-21T00:00:00.000Z");
  assert.equal(Date.parse(challenge.input.expirationTime), now + AUTH_CHALLENGE_TTL_MS);
  assert.match(challenge.input.statement, /does not authorize transactions/);
});

test("round trips signed challenge state and rejects tampering or expiry", async () => {
  const now = Date.parse("2026-09-21T00:00:00.000Z");
  const challenge = createAuthChallenge(walletAddress, config, now);
  const token = await encodeAuthChallenge(challenge, secret);

  assert.deepEqual(await decodeAuthChallenge(token, secret, now + 1), challenge);
  await assert.rejects(
    () => decodeAuthChallenge(`${token.slice(0, -1)}x`, secret, now + 1),
    (error: unknown) => error instanceof AuthError && error.code === "AUTH_CHALLENGE_INVALID",
  );
  await assert.rejects(
    () => decodeAuthChallenge(token, secret, now + AUTH_CHALLENGE_TTL_MS),
    (error: unknown) => error instanceof AuthError && error.code === "AUTH_CHALLENGE_EXPIRED",
  );
});

test("round trips a wallet-bound 24-hour session and rejects expiry", async () => {
  const now = Date.parse("2026-09-21T00:00:00.000Z");
  const session = createAuthSession(walletAddress, now);
  const token = await encodeAuthSession(session, secret);

  assert.equal(session.expiresAt, now + AUTH_SESSION_TTL_MS);
  assert.deepEqual(await decodeAuthSession(token, secret, now + 1), session);
  await assert.rejects(
    () => decodeAuthSession(token, secret, now + AUTH_SESSION_TTL_MS),
    (error: unknown) => error instanceof AuthError && error.code === "SESSION_INVALID",
  );
});

test("requires a strong secret and exact same-origin mutation", () => {
  assert.throws(
    () => getAuthRuntimeConfig({ APP_URL: "https://stockpilot.example/path", SESSION_SECRET: secret }),
    /only an HTTP or HTTPS origin/,
  );
  assert.throws(
    () => getAuthRuntimeConfig({ APP_URL: "https://stockpilot.example", SESSION_SECRET: "short" }),
    /at least 32 bytes/,
  );

  assert.doesNotThrow(() => assertSameOrigin(
    new Request("https://stockpilot.example/api/auth/challenge", {
      headers: { origin: "https://stockpilot.example" },
    }),
    config.appUrl,
  ));
  assert.throws(
    () => assertSameOrigin(
      new Request("https://stockpilot.example/api/auth/challenge", {
        headers: { origin: "https://attacker.example" },
      }),
      config.appUrl,
    ),
    (error: unknown) => error instanceof AuthError && error.code === "AUTH_REQUEST_INVALID",
  );
});
