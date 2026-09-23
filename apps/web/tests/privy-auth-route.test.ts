import assert from "node:assert/strict";
import test from "node:test";
import { createPrivyAuthPost } from "../app/api/auth/privy/route";
import { createAuthSession, decodeAuthSession, encodeAuthSession } from "../lib/auth/session";
import { MemoryAuthSecurityStore } from "../lib/auth/store";
import { PrivyVerificationError, selectPrimaryEmbeddedSolanaWallet } from "../lib/privy/server";

const walletAddress = "11111111111111111111111111111111";
const secret = "privy-test-only-session-secret-longer-than-32-bytes";

test("only one primary Privy-owned embedded Solana wallet is authority", () => {
  const primary = { type: "wallet", chain_type: "solana", wallet_client_type: "privy", connector_type: "embedded", wallet_index: 0, address: walletAddress };
  const phantom = { ...primary, wallet_client_type: "phantom" };
  const additional = { ...primary, wallet_index: 1 };
  assert.equal(selectPrimaryEmbeddedSolanaWallet([phantom, additional, primary]), walletAddress);
  for (const candidates of [[], [phantom], [additional], [primary, primary], [{ ...primary, address: "invalid" }]]) {
    assert.throws(() => selectPrimaryEmbeddedSolanaWallet(candidates), PrivyVerificationError);
  }
});

test("Privy exchange binds only the verified user's wallet and caps session expiry", async () => {
  const previous = {
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
  let receivedToken = "";
  const post = createPrivyAuthPost(async (token) => {
    receivedToken = token;
    return { userId: "did:privy:test", walletAddress, tokenExpiresAt: Date.now() + 30_000 };
  }, store);
  try {
    const response = await post(new Request("http://localhost:3000/api/auth/privy", {
      method: "POST", headers: { origin: "http://localhost:3000", authorization: `Bearer ${"x".repeat(40)}` },
    }));
    assert.equal(response.status, 200);
    assert.equal(receivedToken, "x".repeat(40));
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const token = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
    const session = await decodeAuthSession(token, secret);
    assert.equal(session.authProvider, "privy");
    assert.equal(session.privyUserId, "did:privy:test");
    assert.equal(session.walletAddress, walletAddress);
    assert.ok(session.expiresAt - session.issuedAt <= 30_000);

    const oldWalletSession = await encodeAuthSession(createAuthSession(walletAddress), secret);
    await assert.rejects(decodeAuthSession(oldWalletSession, secret));

    const missingBearer = await post(new Request("http://localhost:3000/api/auth/privy", {
      method: "POST", headers: { origin: "http://localhost:3000" },
    }));
    assert.equal(missingBearer.status, 401);

    const forgedOrigin = await post(new Request("http://localhost:3000/api/auth/privy", {
      method: "POST", headers: { origin: "https://attacker.example", authorization: `Bearer ${"x".repeat(40)}` },
    }));
    assert.equal(forgedOrigin.status, 403);

    const expiredPost = createPrivyAuthPost(async () => ({
      userId: "did:privy:expired", walletAddress, tokenExpiresAt: Date.now() - 1,
    }), store);
    const expiredResponse = await expiredPost(new Request("http://localhost:3000/api/auth/privy", {
      method: "POST", headers: { origin: "http://localhost:3000", authorization: `Bearer ${"x".repeat(40)}` },
    }));
    assert.equal(expiredResponse.status, 401);
    assert.equal(expiredResponse.headers.get("set-cookie"), null);
  } finally {
    if (previous.mode === undefined) delete process.env.NEXT_PUBLIC_AUTH_PROVIDER; else process.env.NEXT_PUBLIC_AUTH_PROVIDER = previous.mode;
    if (previous.auth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = previous.auth;
    if (previous.app === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous.app;
    if (previous.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous.secret;
  }
});
