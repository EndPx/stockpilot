import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_SESSION_COOKIE, getAuthRuntimeConfig } from "../lib/auth/config";
import { createAuthSession, encodeAuthSession, registerAuthSession } from "../lib/auth/session";
import { getAuthSecurityStore } from "../lib/auth/store";
import { requireControlOwner } from "../lib/control-plane/web-api";
import { GET as getClients } from "../app/api/control/clients/route";

process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";
process.env.AUTH_ENABLED = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "control-route-test-secret-at-least-32-bytes";

async function request(origin?: string) {
  const session = createAuthSession("11111111111111111111111111111111", Date.now(), "did:privy:trusted", Date.now() + 40_000);
  await registerAuthSession(session);
  const token = await encodeAuthSession(session, process.env.SESSION_SECRET!);
  return {
    session,
    request: new Request("http://localhost:3000/api/control/clients", {
      headers: { cookie: `${AUTH_SESSION_COOKIE}=${token}`, ...(origin ? { origin } : {}) },
    }),
  };
}

test("control APIs require a live Privy session and server-selected identity", async () => {
  const missing = await getClients(new Request("http://localhost:3000/api/control/clients"));
  assert.equal(missing.status, 401);
  const { session, request: valid } = await request();
  assert.deepEqual(await requireControlOwner(valid), {
    privyUserId: "did:privy:trusted", walletAddress: "11111111111111111111111111111111",
  });
  const forged = new Request("http://localhost:3000/api/control/clients?accountId=did:privy:attacker", {
    headers: { cookie: valid.headers.get("cookie")!, "x-wallet-address": "22222222222222222222222222222222" },
  });
  assert.deepEqual(await requireControlOwner(forged), {
    privyUserId: "did:privy:trusted", walletAddress: "11111111111111111111111111111111",
  });
  await getAuthSecurityStore(getAuthRuntimeConfig()).revokeSession(session.sessionId);
  await assert.rejects(requireControlOwner(valid));
});

test("control writes enforce same origin before request mutation", async () => {
  const { request: noOrigin } = await request();
  await assert.rejects(requireControlOwner(noOrigin, true));
  const { request: wrongOrigin } = await request("https://evil.example");
  await assert.rejects(requireControlOwner(wrongOrigin, true));
  const { request: goodOrigin } = await request("http://localhost:3000");
  assert.equal((await requireControlOwner(goodOrigin, true)).privyUserId, "did:privy:trusted");
});
