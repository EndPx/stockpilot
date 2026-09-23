export function isProtectedPage(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/") ||
    pathname === "/markets" || pathname.startsWith("/markets/") ||
    ["/clients", "/credentials", "/approvals", "/activity"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

/** Only app-local page paths may be passed to the client router after sign-in. */
export function safeReturnPath(candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.length > 2_048 ||
    !candidate.startsWith("/") || candidate.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(candidate)) return "/app";

  try {
    const url = new URL(candidate, "https://stockpilot.invalid");
    if (url.origin !== "https://stockpilot.invalid" || !isProtectedPage(url.pathname)) return "/app";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/app";
  }
}
