export function isProtectedPage(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/") ||
    pathname === "/markets" || pathname.startsWith("/markets/") ||
    ["/clients", "/credentials", "/approvals", "/activity"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

function isOAuthContinuation(url: URL): boolean {
  const id = url.searchParams.get("external_auth_id");
  return url.pathname === "/api/oauth/authorize" &&
    url.searchParams.size === 1 &&
    typeof id === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(id);
}

/** Only app-local page paths may be passed to the client router after sign-in. */
export function safeReturnPath(candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.length > 2_048 ||
    !candidate.startsWith("/") || candidate.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(candidate)) return "/app";

  try {
    const url = new URL(candidate, "https://stockpilot.invalid");
    if (url.origin !== "https://stockpilot.invalid" ||
      (!isProtectedPage(url.pathname) && !isOAuthContinuation(url))) return "/app";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/app";
  }
}
