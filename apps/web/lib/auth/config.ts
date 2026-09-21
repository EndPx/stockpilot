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
};

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
  environment: Partial<Pick<NodeJS.ProcessEnv, "APP_URL" | "SESSION_SECRET" | "NODE_ENV">> = process.env,
): AuthRuntimeConfig {
  const appUrl = parseAppUrl(environment.APP_URL ?? "http://localhost:3000");
  const sessionSecret = environment.SESSION_SECRET;

  if (!sessionSecret || new TextEncoder().encode(sessionSecret).byteLength < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  }

  return {
    appUrl,
    sessionSecret,
    secureCookies: appUrl.protocol === "https:" || environment.NODE_ENV === "production",
  };
}

export function assertSameOrigin(request: Request, appUrl: URL): void {
  const origin = request.headers.get("origin");

  if (!origin || origin !== appUrl.origin) {
    throw new AuthError("AUTH_REQUEST_INVALID", 403, "The request origin is not allowed.");
  }
}
