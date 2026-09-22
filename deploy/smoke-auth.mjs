// Run only after the operator confirms the live deployment:
//   node deploy/smoke-auth.mjs
// Uses ten HTTP requests (at most one cleanup request), an ephemeral in-memory
// Ed25519 identity, and SIWS only. Never reads a real wallet, calls RPC, prepares
// an order, or signs a transaction. Nothing sensitive is printed or persisted.
import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));

const ORIGIN = "https://stockpilot.endpx.cloud";
const STATEMENT = "Sign in to StockPilot. This proves wallet ownership and does not authorize transactions or asset transfers.";
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_REQUESTS = 11;
let requests = 0;

function requireCheck(condition) {
  if (!condition) throw new Error("Smoke check failed.");
}

function pass(check) {
  console.log(`PASS ${check}`);
}

async function jsonBody(response) {
  requireCheck(response.headers.get("content-type")?.split(";", 1)[0] === "application/json");
  requireCheck(response.body);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("Smoke response limit exceeded.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
}

async function call(path, { method = "GET", body, cookie, origin = ORIGIN } = {}) {
  requireCheck(++requests <= MAX_REQUESTS);
  const headers = { Accept: "application/json", Origin: origin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(new URL(path, ORIGIN), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await jsonBody(response);
  return { response, data };
}

function readProtectedCookie(response, name) {
  const cookies = response.headers.getSetCookie();
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  requireCheck(cookie && /;\s*HttpOnly(?:;|$)/i.test(cookie) && /;\s*Secure(?:;|$)/i.test(cookie) && /;\s*SameSite=Lax(?:;|$)/i.test(cookie));
  const pair = cookie.split(";", 1)[0];
  requireCheck(pair.length > name.length + 1 && pair.length < 8_192);
  return pair;
}

function validateSignInInput(input, walletAddress) {
  const expectedKeys = ["address", "chainId", "domain", "expirationTime", "issuedAt", "nonce", "requestId", "statement", "uri", "version"];
  requireCheck(input && typeof input === "object" && !Array.isArray(input));
  requireCheck(JSON.stringify(Object.keys(input).sort()) === JSON.stringify(expectedKeys));
  requireCheck(input.domain === new URL(ORIGIN).host && input.uri === ORIGIN);
  requireCheck(input.address === walletAddress && input.statement === STATEMENT);
  requireCheck(input.version === "1" && input.chainId === "solana:mainnet");
  requireCheck(typeof input.nonce === "string" && /^[0-9a-f]{32}$/.test(input.nonce));
  requireCheck(typeof input.requestId === "string" && /^[0-9a-f-]{36}$/.test(input.requestId));
  const issued = Date.parse(input.issuedAt);
  const expires = Date.parse(input.expirationTime);
  requireCheck(Number.isFinite(issued) && Math.abs(issued - Date.now()) < 60_000);
  requireCheck(expires > Date.now() && expires - issued === 300_000);
}

async function main() {
  const { getAddressDecoder } = requireWeb("@solana/kit");
  const { createSignInMessage } = requireWeb("@solana/wallet-standard-util");
  const health = await call("/api/health");
  requireCheck(health.response.status === 200 && health.data.status === "ok");
  requireCheck(health.data.authEnabled === true && health.data.investmentsEnabled === false && health.data.agentExecutionEnabled === false);
  pass("health_flags");

  // Empty unauthenticated bodies cannot prepare or execute an order even if a
  // deployment's feature flag is wrong. They must still hit the disabled gate.
  for (const operation of ["prepare", "execute"]) {
    const result = await call(`/api/investments/${operation}`, { method: "POST", body: {} });
    requireCheck(result.response.status === 503 && result.data.error?.code === "INVESTMENTS_DISABLED");
    pass(`investment_${operation}_disabled`);
  }

  const crossOrigin = await call("/api/auth/challenge", { method: "POST", body: {}, origin: "https://cross-origin.invalid" });
  requireCheck(crossOrigin.response.status === 403 && crossOrigin.data.error?.code === "AUTH_REQUEST_INVALID");
  pass("cross_origin_denied");

  const keys = generateKeyPairSync("ed25519");
  const encodedPublicKey = keys.publicKey.export({ format: "der", type: "spki" });
  const publicKey = new Uint8Array(encodedPublicKey.subarray(encodedPublicKey.length - 32));
  const walletAddress = getAddressDecoder().decode(publicKey).toString();
  let sessionCookie;
  let loggedOut = false;
  try {
    const challenge = await call("/api/auth/challenge", { method: "POST", body: { walletAddress } });
    requireCheck(challenge.response.status === 200);
    validateSignInInput(challenge.data.input, walletAddress);
    const challengeCookie = readProtectedCookie(challenge.response, "stockpilot-auth-challenge");
    pass("sign_in_challenge");

    const signedMessage = createSignInMessage(challenge.data.input);
    const proof = {
      method: "signIn",
      requestId: challenge.data.input.requestId,
      output: {
        account: { address: walletAddress, publicKey: Buffer.from(publicKey).toString("base64url") },
        signedMessage: Buffer.from(signedMessage).toString("base64url"),
        signature: sign(null, signedMessage, keys.privateKey).toString("base64url"),
        signatureType: "ed25519",
      },
    };
    const verified = await call("/api/auth/verify", { method: "POST", cookie: challengeCookie, body: proof });
    requireCheck(verified.response.status === 200 && verified.data.authenticated === true && verified.data.walletAddress === walletAddress);
    sessionCookie = readProtectedCookie(verified.response, "stockpilot-session");
    pass("sign_in_verified");

    const restored = await call("/api/auth/session", { cookie: sessionCookie });
    requireCheck(restored.response.status === 200 && restored.data.authenticated === true && restored.data.walletAddress === walletAddress);
    pass("session_restored");

    const replay = await call("/api/auth/verify", { method: "POST", cookie: challengeCookie, body: proof });
    requireCheck(replay.response.status === 401 && replay.data.error?.code === "AUTH_REPLAY_DETECTED");
    pass("identical_proof_replay_denied");

    const logout = await call("/api/auth/logout", { method: "POST", cookie: sessionCookie });
    requireCheck(logout.response.status === 200 && logout.data.authenticated === false);
    loggedOut = true;
    pass("logout");

    const copiedCookie = await call("/api/auth/session", { cookie: sessionCookie });
    requireCheck(copiedCookie.response.status === 401 && copiedCookie.data.error?.code === "SESSION_INVALID");
    pass("copied_cookie_revoked");
  } finally {
    if (sessionCookie && !loggedOut && requests < MAX_REQUESTS) {
      await call("/api/auth/logout", { method: "POST", cookie: sessionCookie }).catch(() => {});
    }
  }
}

// Do not emit exception text: HTTP response data and authentication material
// must stay private even when a check fails. Exit status and last PASS identify
// an incomplete run; success always prints all ten named PASS checks.
await main().catch(() => { process.exitCode = 1; });
