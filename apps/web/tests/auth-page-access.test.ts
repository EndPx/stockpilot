import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { guardPrivyPage } from "../lib/auth/page-access";
import { safeReturnPath } from "../lib/auth/page-paths";
import { createAuthSession, encodeAuthSession } from "../lib/auth/session";
import { MemoryAuthSecurityStore } from "../lib/auth/store";

const secret = "page-access-test-session-secret-longer-than-32-bytes";
const wallet = "11111111111111111111111111111111";

function request(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, token ? {
    headers: { cookie: `stockpilot-session=${encodeURIComponent(token)}` },
  } : undefined);
}

test("return path only accepts protected same-origin pages", () => {
  assert.equal(safeReturnPath("/markets?group=public&q=TSLA"), "/markets?group=public&q=TSLA");
  assert.equal(safeReturnPath("/app/credentials"), "/app/credentials");
  for (const target of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/sign-in", "/application", "/markets-other", ["/app"], undefined]) {
    assert.equal(safeReturnPath(target), "/app");
  }
});

test("Privy page guard redirects guests, rejects bad sessions and admits active sessions", async () => {
  const before = {
    mode: process.env.NEXT_PUBLIC_AUTH_PROVIDER,
    auth: process.env.AUTH_ENABLED,
    app: process.env.APP_URL,
    secret: process.env.SESSION_SECRET,
  };
  process.env.NEXT_PUBLIC_AUTH_PROVIDER = "privy";
  process.env.AUTH_ENABLED = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SESSION_SECRET = secret;
  const store = new MemoryAuthSecurityStore();
  try {
    assert.equal(await guardPrivyPage(request("/"), store), null);
    assert.equal(await guardPrivyPage(request("/sign-in"), store), null);
    assert.equal(await guardPrivyPage(request("/api/markets"), store), null);

    for (const path of ["/app", "/app/credentials", "/markets?group=public", "/markets/xstocks/ABC"]) {
      const response = await guardPrivyPage(request(path), store);
      assert.equal(response?.status, 307);
      const location = new URL(response?.headers.get("location") ?? "");
      assert.equal(location.pathname, "/sign-in");
      assert.equal(location.searchParams.get("next"), path);
    }

    const invalid = await guardPrivyPage(request("/app", "forged"), store);
    assert.equal(invalid?.status, 307);
    assert.match(invalid?.headers.get("set-cookie") ?? "", /Max-Age=0/);

    const post = await guardPrivyPage(new NextRequest("http://localhost:3000/app", { method: "POST" }), store);
    assert.equal(post?.status, 303);

    const session = createAuthSession(wallet, Date.now(), "did:privy:page-access", Date.now() + 60_000);
    const token = await encodeAuthSession(session, secret);
    assert.equal((await guardPrivyPage(request("/markets?group=private", token), store))?.status, 307);
    await store.registerSession(session.sessionId, { walletAddress: wallet, expiresAt: session.expiresAt });
    assert.equal(await guardPrivyPage(request("/app/credentials", token), store), null);

    const unavailable = new MemoryAuthSecurityStore();
    unavailable.readSession = async () => { throw new Error("store offline"); };
    assert.equal((await guardPrivyPage(request("/app", token), unavailable))?.status, 503);

    await store.revokeSession(session.sessionId);
    const revoked = await guardPrivyPage(request("/app", token), store);
    assert.equal(revoked?.status, 307);
    assert.match(revoked?.headers.get("set-cookie") ?? "", /Max-Age=0/);
  } finally {
    for (const [key, value] of Object.entries({
      NEXT_PUBLIC_AUTH_PROVIDER: before.mode,
      AUTH_ENABLED: before.auth,
      APP_URL: before.app,
      SESSION_SECRET: before.secret,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
