import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import test, { beforeEach } from "node:test";
import { getAddressDecoder } from "@solana/kit";
import { createSignInMessage } from "@solana/wallet-standard-util";
import { createAuthChallengePost } from "../app/api/auth/challenge/route";
import { createAuthLogoutPost } from "../app/api/auth/logout/route";
import { createAuthSessionGet } from "../app/api/auth/session/route";
import { createAuthVerifyPost } from "../app/api/auth/verify/route";
import { createAuthChallenge, encodeAuthChallenge } from "../lib/auth/challenge";
import { AUTH_CHALLENGE_COOKIE, getAuthRuntimeConfig } from "../lib/auth/config";
import type { AuthSignInInput, AuthVerifyRequest } from "../lib/auth/types";
import { MemoryAuthSecurityStore } from "../lib/auth/store";

process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "route-test-secret-with-at-least-32-bytes";

const origin = "http://localhost:3000";
let challengePost: ReturnType<typeof createAuthChallengePost>;
let logoutPost: ReturnType<typeof createAuthLogoutPost>;
let sessionGet: ReturnType<typeof createAuthSessionGet>;
let verifyPost: ReturnType<typeof createAuthVerifyPost>;

beforeEach(() => {
  const store = new MemoryAuthSecurityStore();
  challengePost = createAuthChallengePost(store);
  logoutPost = createAuthLogoutPost(store);
  sessionGet = createAuthSessionGet(store);
  verifyPost = createAuthVerifyPost(store);
});

type TestWallet = {
  address: string;
  privateKey: KeyObject;
  publicKey: Uint8Array;
};

function createWallet(): TestWallet {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));
  return {
    address: getAddressDecoder().decode(publicKey).toString(),
    privateKey: pair.privateKey,
    publicKey,
  };
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`${origin}${path}`, { ...init, headers });
}

function cookieValues(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
}

function cookiePair(response: Response, name: string): string {
  const value = cookieValues(response).find((cookie) => cookie.startsWith(`${name}=`));
  assert.ok(value, `expected ${name} cookie`);
  return value.split(";", 1)[0];
}

async function errorCode(response: Response): Promise<string> {
  const body = await response.json() as { error: { code: string } };
  return body.error.code;
}

async function issueChallenge(wallet: TestWallet, headers: HeadersInit = {}): Promise<{
  cookie: string;
  input: AuthSignInInput;
}> {
  const response = await challengePost(request("/api/auth/challenge", {
    method: "POST",
    headers,
    body: JSON.stringify({ walletAddress: wallet.address }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { input: AuthSignInInput };
  return { cookie: cookiePair(response, AUTH_CHALLENGE_COOKIE), input: body.input };
}

function createProof(
  wallet: TestWallet,
  input: AuthSignInInput,
  overrides: Partial<AuthSignInInput> = {},
): AuthVerifyRequest {
  const signedMessage = createSignInMessage({ ...input, ...overrides });
  const signature = new Uint8Array(sign(null, signedMessage, wallet.privateKey));
  return {
    method: "signIn",
    requestId: input.requestId,
    output: {
      account: {
        address: wallet.address,
        publicKey: Buffer.from(wallet.publicKey).toString("base64url"),
      },
      signedMessage: Buffer.from(signedMessage).toString("base64url"),
      signature: Buffer.from(signature).toString("base64url"),
      signatureType: "ed25519",
    },
  };
}

async function verify(cookie: string | undefined, proof: AuthVerifyRequest): Promise<Response> {
  return verifyPost(request("/api/auth/verify", {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
    body: JSON.stringify(proof),
  }));
}

test("accepts a valid proof, restores its wallet-bound session, and logs out", async () => {
  const wallet = createWallet();
  const challenge = await issueChallenge(wallet);
  const response = await verify(challenge.cookie, createProof(wallet, challenge.input));

  assert.equal(response.status, 200);
  const authenticated = await response.json() as { authenticated: boolean; walletAddress: string };
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.walletAddress, wallet.address);

  const sessionCookie = cookiePair(response, "stockpilot-session");
  const restored = await sessionGet(request("/api/auth/session", { headers: { cookie: sessionCookie } }));
  assert.equal(restored.status, 200);
  assert.deepEqual(
    await restored.json() as { authenticated: boolean; walletAddress: string },
    { ...authenticated, expiresAt: (authenticated as { expiresAt?: string }).expiresAt },
  );

  const loggedOut = await logoutPost(request("/api/auth/logout", {
    method: "POST",
    headers: { cookie: sessionCookie },
  }));
  assert.equal(loggedOut.status, 200);
  assert.equal((await loggedOut.json() as { authenticated: boolean }).authenticated, false);
  assert.match(cookieValues(loggedOut).join("\n"), /stockpilot-session=; Max-Age=0/);
  const copiedSession = await sessionGet(request("/api/auth/session", { headers: { cookie: sessionCookie } }));
  assert.equal(copiedSession.status, 401);
  assert.equal(await errorCode(copiedSession), "SESSION_INVALID");
});

test("rejects an invalid signature and consumes the challenge", async () => {
  const wallet = createWallet();
  const challenge = await issueChallenge(wallet);
  const proof = createProof(wallet, challenge.input);
  const signature = Buffer.from(proof.output.signature, "base64url");
  signature[0] ^= 1;
  proof.output.signature = signature.toString("base64url");

  const response = await verify(challenge.cookie, proof);
  assert.equal(await errorCode(response), "AUTH_SIGNATURE_INVALID");
  assert.match(cookieValues(response).join("\n"), /stockpilot-auth-challenge=; Max-Age=0/);
  const savedCookieReplay = await verify(challenge.cookie, createProof(wallet, challenge.input));
  assert.equal(await errorCode(savedCookieReplay), "AUTH_REPLAY_DETECTED");
});

test("rejects tampered statement and wrong nonce", async () => {
  const wallet = createWallet();
  const first = await issueChallenge(wallet);
  const tampered = await verify(first.cookie, createProof(wallet, first.input, { statement: "Authorize a transfer" }));
  assert.equal(await errorCode(tampered), "AUTH_CHALLENGE_INVALID");

  const second = await issueChallenge(wallet);
  const wrongNonce = await verify(second.cookie, createProof(wallet, second.input, { nonce: "wrongnonce" }));
  assert.equal(await errorCode(wrongNonce), "AUTH_CHALLENGE_INVALID");
});

test("rejects wrong domain and wrong wallet", async () => {
  const wallet = createWallet();
  const domainChallenge = await issueChallenge(wallet);
  const wrongDomain = await verify(
    domainChallenge.cookie,
    createProof(wallet, domainChallenge.input, { domain: "attacker.example", uri: "https://attacker.example" }),
  );
  assert.equal(await errorCode(wrongDomain), "AUTH_DOMAIN_MISMATCH");

  const otherWallet = createWallet();
  const walletChallenge = await issueChallenge(wallet);
  const wrongWallet = await verify(walletChallenge.cookie, createProof(otherWallet, walletChallenge.input));
  assert.equal(await errorCode(wrongWallet), "AUTH_WALLET_MISMATCH");
});

test("rejects expired challenges and a replay without the consumed cookie", async () => {
  const wallet = createWallet();
  const config = getAuthRuntimeConfig();
  const expiredChallenge = createAuthChallenge(wallet.address, config, Date.now() - 6 * 60_000);
  const expiredToken = await encodeAuthChallenge(expiredChallenge, config.sessionSecret);
  const expired = await verify(
    `${AUTH_CHALLENGE_COOKIE}=${expiredToken}`,
    createProof(wallet, expiredChallenge.input),
  );
  assert.equal(await errorCode(expired), "AUTH_CHALLENGE_EXPIRED");

  const challenge = await issueChallenge(wallet);
  const proof = createProof(wallet, challenge.input);
  assert.equal((await verify(challenge.cookie, proof)).status, 200);
  const replay = await verify(undefined, proof);
  assert.equal(await errorCode(replay), "AUTH_REPLAY_DETECTED");
});

test("rejects cross-origin authentication mutations", async () => {
  const wallet = createWallet();
  const response = await challengePost(new Request(`${origin}/api/auth/challenge`, {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ walletAddress: wallet.address }),
  }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "AUTH_REQUEST_INVALID");
});

test("rejects and clears a tampered session cookie", async () => {
  const response = await sessionGet(request("/api/auth/session", {
    headers: { cookie: "stockpilot-session=v1.tampered.invalid" },
  }));

  assert.equal(response.status, 401);
  assert.equal(await errorCode(response), "SESSION_INVALID");
  assert.match(cookieValues(response).join("\n"), /stockpilot-session=; Max-Age=0/);
});

test("the exact saved challenge cookie and valid proof cannot be replayed", async () => {
  const wallet = createWallet();
  const challenge = await issueChallenge(wallet);
  const proof = createProof(wallet, challenge.input);
  assert.equal((await verify(challenge.cookie, proof)).status, 200);
  const replay = await verify(challenge.cookie, proof);
  assert.equal(replay.status, 401);
  assert.equal(await errorCode(replay), "AUTH_REPLAY_DETECTED");
});

test("concurrent valid proofs consume one challenge atomically", async () => {
  const wallet = createWallet();
  const challenge = await issueChallenge(wallet);
  const proof = createProof(wallet, challenge.input);
  const responses = await Promise.all(Array.from({ length: 5 }, () => verify(challenge.cookie, proof)));
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 401, 401, 401, 401]);
  for (const response of responses.filter(({ status }) => status !== 200)) assert.equal(await errorCode(response), "AUTH_REPLAY_DETECTED");
});

test("challenge requests are wallet-rate-limited with Retry-After", async () => {
  const wallet = createWallet();
  for (let index = 0; index < 10; index++) await issueChallenge(wallet);
  const response = await challengePost(request("/api/auth/challenge", {
    method: "POST", body: JSON.stringify({ walletAddress: wallet.address }),
  }));
  assert.equal(response.status, 429);
  assert.equal(await errorCode(response), "AUTH_RATE_LIMITED");
  assert.ok(Number(response.headers.get("retry-after")) > 0);
});

test("disabled authentication returns 503 even for a session probe without cookies", async () => {
  const original = process.env.AUTH_ENABLED;
  process.env.AUTH_ENABLED = "false";
  try {
    const response = await sessionGet(request("/api/auth/session"));
    assert.equal(response.status, 503);
    assert.equal(await errorCode(response), "AUTH_DISABLED");
  } finally {
    if (original === undefined) delete process.env.AUTH_ENABLED;
    else process.env.AUTH_ENABLED = original;
  }
});

test("unauthenticated callers cannot exhaust another IP's wallet sign-in budget", async () => {
  const original = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "true";
  try {
    const wallet = createWallet();
    for (let index = 0; index < 10; index++) await issueChallenge(wallet, { "x-real-ip": "203.0.113.10" });
    const blocked = await challengePost(request("/api/auth/challenge", {
      method: "POST", headers: { "x-real-ip": "203.0.113.10" }, body: JSON.stringify({ walletAddress: wallet.address }),
    }));
    assert.equal(blocked.status, 429);
    await issueChallenge(wallet, { "x-real-ip": "203.0.113.20" });
  } finally {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  }
});

test("logout consumes a pending challenge before clearing its cookie", async () => {
  const wallet = createWallet();
  const challenge = await issueChallenge(wallet);
  const proof = createProof(wallet, challenge.input);
  assert.equal((await logoutPost(request("/api/auth/logout", { method: "POST", headers: { cookie: challenge.cookie } }))).status, 200);
  const replay = await verify(challenge.cookie, proof);
  assert.equal(await errorCode(replay), "AUTH_REPLAY_DETECTED");
});

test("a previously issued proof cannot authenticate a different configured origin", async () => {
  const wallet = createWallet();
  const challenge = await issueChallenge(wallet);
  const proof = createProof(wallet, challenge.input);
  const original = process.env.APP_URL;
  process.env.APP_URL = "https://another.example";
  try {
    const response = await verifyPost(new Request("https://another.example/api/auth/verify", {
      method: "POST", headers: { origin: "https://another.example", "content-type": "application/json", cookie: challenge.cookie }, body: JSON.stringify(proof),
    }));
    assert.equal(response.status, 401);
    assert.equal(await errorCode(response), "AUTH_DOMAIN_MISMATCH");
  } finally { process.env.APP_URL = original; }
});
