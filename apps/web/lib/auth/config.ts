import { AuthError } from "./errors";

export const AUTH_CHALLENGE_COOKIE = "stockpilot-auth-challenge";
export const AUTH_SESSION_COOKIE = "stockpilot-session";
export const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
export const AUTH_STATEMENT =
  "Sign in to StockPilot. This proves wallet ownership and does not authorize transactions or asset transfers.";

export type AuthRuntimeConfig = {
  appUrl: URL;
  sessionSecret: string;
  secureCookies: boolean;
  redisUrl?: string;
  trustProxy: boolean;
  production: boolean;
};

type AuthEnvironment = Partial<Pick<NodeJS.ProcessEnv, "APP_URL" | "SESSION_SECRET" | "NODE_ENV" | "AUTH_ENABLED" | "REDIS_URL" | "TRUST_PROXY">>;

function parseAppUrl(value: string): URL {
  let appUrl: URL;

  try {
    appUrl = new URL(value);
  } catch {
    throw new Error("APP_URL must be an absolute HTTP or HTTPS URL.");
  }

  if (
    (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") ||
    appUrl.username ||
    appUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    (appUrl.pathname !== "/" && appUrl.pathname !== "")
  ) {
    throw new Error("APP_URL must contain only an HTTP or HTTPS origin.");
  }

  return new URL(appUrl.origin);
}

export function getAuthRuntimeConfig(
  environment: AuthEnvironment = process.env,
): AuthRuntimeConfig {
  const production = environment.NODE_ENV === "production";
  if (environment.AUTH_ENABLED === "false" || production && environment.AUTH_ENABLED !== "true") {
    throw new AuthError("AUTH_DISABLED", 503);
  }
  if (production && (!environment.APP_URL || !environment.REDIS_URL)) {
    throw new AuthError("AUTH_UNAVAILABLE", 503);
  }
  let appUrl: URL;
  try { appUrl = parseAppUrl(environment.APP_URL ?? "http://localhost:3000"); }
  catch (error) { if (production) throw new AuthError("AUTH_UNAVAILABLE", 503); throw error; }
  const sessionSecret = environment.SESSION_SECRET;

  if (!sessionSecret || new TextEncoder().encode(sessionSecret).byteLength < 32) {
    if (production) throw new AuthError("AUTH_UNAVAILABLE", 503);
    throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  }
  if (production && appUrl.protocol !== "https:") throw new AuthError("AUTH_UNAVAILABLE", 503);
  if (environment.REDIS_URL) {
    try {
      const url = new URL(environment.REDIS_URL);
      if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname || url.hash || url.search) throw new Error();
    } catch { throw new AuthError("AUTH_UNAVAILABLE", 503); }
  }

  return {
    appUrl,
    sessionSecret,
    secureCookies: appUrl.protocol === "https:" || production,
    redisUrl: environment.REDIS_URL,
    trustProxy: environment.TRUST_PROXY === "true",
    production,
  };
}

/** Configuration availability only; Redis liveness is checked by each auth operation. */
export function isAuthEnabled(environment: AuthEnvironment = process.env): boolean {
  try { getAuthRuntimeConfig(environment); return true; } catch { return false; }
}

export function assertSameOrigin(request: Request, appUrl: URL): void {
  const origin = request.headers.get("origin");

  if (!origin || origin !== appUrl.origin) {
    throw new AuthError("AUTH_REQUEST_INVALID", 403, "The request origin is not allowed.");
  }
}
