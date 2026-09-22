import { createClient } from "redis";
import { AUTH_CHALLENGE_TTL_MS, AUTH_SESSION_TTL_MS, type AuthRuntimeConfig } from "./config";
import { AuthError } from "./errors";

export type StoredSession = { walletAddress: string; expiresAt: number };
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
export interface AuthSecurityStore {
  registerChallenge(requestId: string, expiresAt: number): Promise<void>;
  consumeChallenge(requestId: string): Promise<boolean>;
  registerSession(sessionId: string, session: StoredSession): Promise<void>;
  readSession(sessionId: string): Promise<StoredSession | null>;
  revokeSession(sessionId: string): Promise<void>;
  takeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

function ttl(expiresAt: number, maximum: number, now = Date.now()): number {
  const remaining = expiresAt - now;
  if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > maximum) throw new AuthError("AUTH_UNAVAILABLE", 503);
  return remaining;
}

/** Development/tests only. Refuse capacity exhaustion rather than evicting security state. */
export class MemoryAuthSecurityStore implements AuthSecurityStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = 10_000) {}
  private get(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now()) { this.entries.delete(key); return undefined; }
    return entry;
  }
  private set(key: string, value: string, expiresAt: number) {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      for (const [candidate, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(candidate);
      if (this.entries.size >= this.maxEntries) throw new AuthError("AUTH_UNAVAILABLE", 503);
    }
    this.entries.set(key, { value, expiresAt });
  }
  async registerChallenge(requestId: string, expiresAt: number) {
    ttl(expiresAt, AUTH_CHALLENGE_TTL_MS, this.now());
    const key = `challenge:${requestId}`;
    if (expiresAt <= this.now() || this.get(key)) throw new AuthError("AUTH_UNAVAILABLE", 503);
    this.set(key, "1", expiresAt);
  }
  async consumeChallenge(requestId: string) {
    const key = `challenge:${requestId}`;
    const found = !!this.get(key);
    this.entries.delete(key);
    return found;
  }
  async registerSession(sessionId: string, session: StoredSession) {
    ttl(session.expiresAt, AUTH_SESSION_TTL_MS, this.now());
    const key = `session:${sessionId}`;
    if (session.expiresAt <= this.now() || this.get(key)) throw new AuthError("AUTH_UNAVAILABLE", 503);
    this.set(key, JSON.stringify(session), session.expiresAt);
  }
  async readSession(sessionId: string): Promise<StoredSession | null> {
    const entry = this.get(`session:${sessionId}`);
    return entry ? JSON.parse(entry.value) as StoredSession : null;
  }
  async revokeSession(sessionId: string) { this.entries.delete(`session:${sessionId}`); }
  async takeRateLimit(key: string, limit: number, windowMs: number) {
    const storageKey = `limit:${key}`;
    const old = this.get(storageKey);
    const count = Number(old?.value ?? 0) + 1;
    const expiresAt = old?.expiresAt ?? this.now() + windowMs;
    this.set(storageKey, String(count), expiresAt);
    return { allowed: count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - this.now()) / 1000)) };
  }
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

export class RedisAuthSecurityStore implements AuthSecurityStore {
  private connecting?: Promise<unknown>;
  constructor(
    url: string,
    private readonly client = createClient({ url, disableOfflineQueue: true, commandsQueueMaxLength: 1_024, socket: { connectTimeout: 3_000, socketTimeout: 3_000, reconnectStrategy: false } }),
    private readonly deadlineMs = 5_000,
  ) {
    // Redis errors can contain credentials/hosts. Responses and logs must not expose them.
    this.client.on("error", () => {});
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      const work = async () => {
        if (!this.client.isReady) {
          this.connecting ??= this.client.connect().finally(() => { this.connecting = undefined; });
          await this.connecting;
        }
        if (expired) throw new AuthError("AUTH_UNAVAILABLE", 503);
        return operation();
      };
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          // Command timeouts in the driver only cover queued work. Destroy the
          // connection to flush commands awaiting a reply; never retry mutations.
          try { if (this.client.isOpen) this.client.destroy(); } catch { /* already closed */ }
          reject(new AuthError("AUTH_UNAVAILABLE", 503));
        }, this.deadlineMs);
      });
      return await Promise.race([work(), deadline]);
    } catch { throw new AuthError("AUTH_UNAVAILABLE", 503); }
    finally { if (timer) clearTimeout(timer); }
  }
  async registerChallenge(requestId: string, expiresAt: number) {
    const lifetime = ttl(expiresAt, AUTH_CHALLENGE_TTL_MS);
    const result = await this.run(() => this.client.set(`stockpilot:auth:challenge:${requestId}`, "1", { PX: lifetime, NX: true }));
    if (result !== "OK") throw new AuthError("AUTH_UNAVAILABLE", 503);
  }
  async consumeChallenge(requestId: string) {
    return await this.run(() => this.client.getDel(`stockpilot:auth:challenge:${requestId}`)) === "1";
  }
  async registerSession(sessionId: string, session: StoredSession) {
    const lifetime = ttl(session.expiresAt, AUTH_SESSION_TTL_MS);
    const result = await this.run(() => this.client.set(`stockpilot:auth:session:${sessionId}`, JSON.stringify(session), { PX: lifetime, NX: true }));
    if (result !== "OK") throw new AuthError("AUTH_UNAVAILABLE", 503);
  }
  async readSession(sessionId: string): Promise<StoredSession | null> {
    const value = await this.run(() => this.client.get(`stockpilot:auth:session:${sessionId}`));
    if (!value) return null;
    try {
      const session = JSON.parse(value) as StoredSession;
      if (typeof session.walletAddress !== "string" || !Number.isFinite(session.expiresAt)) throw new Error();
      return session;
    } catch { throw new AuthError("AUTH_UNAVAILABLE", 503); }
  }
  async revokeSession(sessionId: string) { await this.run(() => this.client.del(`stockpilot:auth:session:${sessionId}`)); }
  async takeRateLimit(key: string, limit: number, windowMs: number) {
    const result = await this.run(() => this.client.eval(RATE_LIMIT_SCRIPT, { keys: [`stockpilot:auth:limit:${key}`], arguments: [String(windowMs)] }));
    if (!Array.isArray(result) || result.length !== 2) throw new AuthError("AUTH_UNAVAILABLE", 503);
    const [count, ttl] = result.map(Number);
    if (!Number.isSafeInteger(count) || !Number.isFinite(ttl) || count < 1 || ttl < 0) throw new AuthError("AUTH_UNAVAILABLE", 503);
    return { allowed: count <= limit, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
  }
}

const state = globalThis as typeof globalThis & {
  stockpilotAuthMemory?: MemoryAuthSecurityStore;
  stockpilotAuthRedis?: { url: string; store: RedisAuthSecurityStore };
};

export function getAuthSecurityStore(config: AuthRuntimeConfig): AuthSecurityStore {
  if (config.redisUrl) {
    if (!state.stockpilotAuthRedis || state.stockpilotAuthRedis.url !== config.redisUrl) {
      state.stockpilotAuthRedis = { url: config.redisUrl, store: new RedisAuthSecurityStore(config.redisUrl) };
    }
    return state.stockpilotAuthRedis.store;
  }
  if (config.production) throw new AuthError("AUTH_UNAVAILABLE", 503);
  return state.stockpilotAuthMemory ??= new MemoryAuthSecurityStore();
}
