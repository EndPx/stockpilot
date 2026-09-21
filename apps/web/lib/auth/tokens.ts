import { AuthError } from "./errors";

const TOKEN_VERSION = "v1";
const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuthError("AUTH_SESSION_INVALID", 401);
  }

  const decoded = new Uint8Array(Buffer.from(value, "base64url"));
  if (encodeBase64Url(decoded) !== value) {
    throw new AuthError("AUTH_SESSION_INVALID", 401);
  }
  return decoded;
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function createSignedToken(payload: unknown, secret: string): Promise<string> {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const authenticatedValue = `${TOKEN_VERSION}.${encodedPayload}`;
  const signature = await hmac(authenticatedValue, secret);
  return `${authenticatedValue}.${encodeBase64Url(signature)}`;
}

export async function readSignedToken(token: string, secret: string): Promise<unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) {
    throw new AuthError("AUTH_SESSION_INVALID", 401);
  }

  const authenticatedValue = `${parts[0]}.${parts[1]}`;
  const actualSignature = decodeBase64Url(parts[2]);
  const expectedSignature = await hmac(authenticatedValue, secret);

  if (!equalBytes(actualSignature, expectedSignature)) {
    throw new AuthError("AUTH_SESSION_INVALID", 401);
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AuthError("AUTH_SESSION_INVALID", 401);
  }
}
