import assert from "node:assert/strict";
import test from "node:test";
import { getAuthRuntimeConfig, isAuthEnabled } from "../lib/auth/config";
import { AuthError } from "../lib/auth/errors";
import { readJsonBody } from "../lib/auth/http";
import { trustedClientIp, enforceRateLimit } from "../lib/auth/rate-limit";
import { getAuthSecurityStore, MemoryAuthSecurityStore, RedisAuthSecurityStore } from "../lib/auth/store";

const production = {
  NODE_ENV: "production" as const,
  AUTH_ENABLED: "true", APP_URL: "https://stockpilot.example",
  SESSION_SECRET: "unit-test-only-secret-with-more-than-32-bytes",
  REDIS_URL: "redis://127.0.0.1:6379",
};

test("production authentication stays closed until explicitly configured", () => {
  for (const changed of [
    { AUTH_ENABLED: undefined }, { AUTH_ENABLED: "false" }, { APP_URL: undefined },
    { APP_URL: "http://stockpilot.example" }, { APP_URL: "https://stockpilot.example/path" },
    { REDIS_URL: undefined }, { REDIS_URL: "https://redis.example" }, { SESSION_SECRET: "short" },
  ]) {
    assert.equal(isAuthEnabled({ ...production, ...changed }), false);
    assert.throws(() => getAuthRuntimeConfig({ ...production, ...changed }), (error) => error instanceof AuthError && error.status === 503);
  }
  assert.equal(isAuthEnabled(production), true);
  const config = getAuthRuntimeConfig(production);
  assert.throws(() => getAuthSecurityStore({ ...config, redisUrl: undefined }), (error) => error instanceof AuthError && error.status === 503);
});

test("trusted proxy identity only uses valid overwritten X-Real-IP when opted in", () => {
  const request = new Request("https://stockpilot.example", { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.8" } });
  assert.equal(trustedClientIp(request, { trustProxy: false }), "untrusted");
  assert.equal(trustedClientIp(request, { trustProxy: true }), "203.0.113.7");
  assert.equal(trustedClientIp(new Request("https://stockpilot.example", { headers: { "x-real-ip": "203.0.113.7, 127.0.0.1" } }), { trustProxy: true }), "untrusted");
});

test("oversized undeclared request streams are cancelled before being drained", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(9_000)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request("https://stockpilot.example/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half",
  } as RequestInit);
  await assert.rejects(readJsonBody(request), (error) => error instanceof AuthError && error.status === 413);
  assert.equal(cancelled, true);
  assert.equal(pulls, 2);
});

test("JSON parser rejects unsupported media types and accepts bounded JSON", async () => {
  await assert.rejects(readJsonBody(new Request("https://stockpilot.example", { method: "POST", body: "{}" })), (error) => error instanceof AuthError && error.status === 415);
  assert.deepEqual(await readJsonBody(new Request("https://stockpilot.example", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: '{"ok":true}' })), { ok: true });
});

test("atomic counters share limits, expire, and bounded memory refuses overflow", async () => {
  let now = 1_000;
  const store = new MemoryAuthSecurityStore(() => now, 2);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => enforceRateLimit(store, "test", "same-client", 2, 1_000)));
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 2);
  for (const result of results) if (result.status === "rejected") assert.equal((result.reason as AuthError).status, 429);
  now += 1_000;
  await enforceRateLimit(store, "test", "same-client", 2, 1_000);
  await store.registerChallenge("one", now + 100);
  await assert.rejects(store.registerChallenge("two", now + 100), (error) => error instanceof AuthError && error.status === 503);
  now += 101;
  await store.registerChallenge("two", now + 100);
  await assert.rejects(store.registerChallenge("invalid", Number.NaN), (error) => error instanceof AuthError && error.status === 503);
});

test("an accepted Redis command with no reply has an absolute deadline and is never retried", async () => {
  let commands = 0;
  let destroyed = 0;
  const client = {
    isReady: true, isOpen: true,
    on() {},
    getDel() { commands++; return new Promise(() => {}); },
    destroy() { destroyed++; },
  };
  const store = new RedisAuthSecurityStore("redis://unused.test", client as unknown as NonNullable<ConstructorParameters<typeof RedisAuthSecurityStore>[1]>, 20);
  const began = Date.now();
  await assert.rejects(store.consumeChallenge("test"), (error) => error instanceof AuthError && error.status === 503);
  assert.ok(Date.now() - began < 1_000);
  assert.equal(commands, 1);
  assert.equal(destroyed, 1);
});
