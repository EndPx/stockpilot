import type { AuthRuntimeConfig } from "./config";
import { AUTH_CHALLENGE_COOKIE, AUTH_CHALLENGE_TTL_MS, AUTH_SESSION_COOKIE, AUTH_SESSION_TTL_MS } from "./config";
import { AuthError, toAuthError } from "./errors";
import type { AuthErrorResponse } from "./types";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, headerValue] of Object.entries(NO_STORE_HEADERS)) {
    if (!headers.has(name)) headers.set(name, headerValue);
  }
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function authErrorResponse(error: unknown, headers?: Headers): Response {
  const authError = toAuthError(error);
  headers ??= new Headers();
  if (authError.retryAfterSeconds !== undefined) headers.set("Retry-After", String(authError.retryAfterSeconds));
  const body: AuthErrorResponse = {
    error: { code: authError.code, message: authError.message },
  };
  return jsonResponse(body, { status: authError.status, headers });
}

export async function readJsonBody(request: Request, maxBytes = 16_384): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    await request.body?.cancel().catch(() => {});
    throw new AuthError("AUTH_REQUEST_INVALID", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await request.body?.cancel().catch(() => {});
    throw new AuthError("AUTH_REQUEST_INVALID", 413, "The authentication request is too large.");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("AUTH_REQUEST_INVALID", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new AuthError("AUTH_REQUEST_INVALID", 413, "The authentication request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!length) throw new AuthError("AUTH_REQUEST_INVALID", 400);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AuthError("AUTH_REQUEST_INVALID", 400);
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(item.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function cookieAttributes(config: Pick<AuthRuntimeConfig, "secureCookies">, path: string): string {
  return `Path=${path}; HttpOnly; SameSite=Lax${config.secureCookies ? "; Secure" : ""}`;
}

export function setChallengeCookie(
  headers: Headers,
  token: string,
  config: Pick<AuthRuntimeConfig, "secureCookies">,
): void {
  headers.append(
    "Set-Cookie",
    `${AUTH_CHALLENGE_COOKIE}=${encodeURIComponent(token)}; Max-Age=${AUTH_CHALLENGE_TTL_MS / 1_000}; ${cookieAttributes(config, "/api/auth")}`,
  );
}

export function setSessionCookie(
  headers: Headers,
  token: string,
  config: Pick<AuthRuntimeConfig, "secureCookies">,
  maxAgeSeconds = AUTH_SESSION_TTL_MS / 1_000,
): void {
  headers.append(
    "Set-Cookie",
    `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; ${cookieAttributes(config, "/")}`,
  );
}

function clearCookie(headers: Headers, name: string, path: string, config: Pick<AuthRuntimeConfig, "secureCookies">): void {
  headers.append(
    "Set-Cookie",
    `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${cookieAttributes(config, path)}`,
  );
}

export function clearChallengeCookie(headers: Headers, config: Pick<AuthRuntimeConfig, "secureCookies">): void {
  clearCookie(headers, AUTH_CHALLENGE_COOKIE, "/api/auth", config);
}

export function clearSessionCookie(headers: Headers, config: Pick<AuthRuntimeConfig, "secureCookies">): void {
  clearCookie(headers, AUTH_SESSION_COOKIE, "/", config);
}
