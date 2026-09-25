import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/security-headers";
import { guardPrivyPage } from "@/lib/auth/page-access";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  // Only the owner-review page may submit through a vetted AuthKit origin.
  // Chromium applies form-action to the POST response's cross-origin redirect.
  const oauthFormIssuer = request.nextUrl.pathname === "/connect" && process.env.AGENT_OAUTH_ENABLED === "true"
    ? process.env.WORKOS_AUTHKIT_ISSUER : undefined;
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production", oauthFormIssuer);
  const requestHeaders = new Headers(request.headers);
  // Replace caller-supplied values; a client cannot select the rendering nonce.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = await guardPrivyPage(request) ?? NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|brand/|artwork/).*)"] };
