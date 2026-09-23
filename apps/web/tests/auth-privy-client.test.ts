import assert from "node:assert/strict";
import test from "node:test";
import { exchangePrivySession, PrivySessionError } from "../lib/privy/client-session";

const session = { authenticated: true, walletAddress: "11111111111111111111111111111111", expiresAt: new Date(Date.now() + 60_000).toISOString() };

test("Privy exchange retries only wallet provisioning once", async () => {
  const calls: string[] = [];
  let count = 0;
  const result = await exchangePrivySession(async () => "test-access-token", {
    request: async (_url, init) => {
      calls.push(String(init?.headers && "Authorization" in init.headers && init.headers.Authorization));
      count += 1;
      return Response.json(count === 1
        ? { error: { code: "AUTH_WALLET_PENDING", message: "Wallet is being created" } }
        : session, { status: count === 1 ? 503 : 200 });
    },
    pause: async (ms) => { assert.equal(ms, 1_200); },
  });
  assert.deepEqual(result, session);
  assert.deepEqual(calls, ["Bearer test-access-token", "Bearer test-access-token"]);
});

test("Privy exchange never retries invalid authorization", async () => {
  let count = 0;
  await assert.rejects(exchangePrivySession(async () => "test-access-token", {
    request: async () => {
      count += 1;
      return Response.json({ error: { code: "AUTH_REQUEST_INVALID", message: "Invalid request" } }, { status: 401 });
    },
    pause: async () => { throw new Error("Unexpected retry"); },
  }), (error: unknown) => error instanceof PrivySessionError && error.code === "AUTH_REQUEST_INVALID");
  assert.equal(count, 1);
});

test("Privy exchange rejects malformed success instead of trusting its wallet", async () => {
  await assert.rejects(exchangePrivySession(async () => "test-access-token", {
    request: async () => Response.json({ authenticated: true, walletAddress: "forged" }),
  }), PrivySessionError);
});
