function safeOAuthFormOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password &&
      !url.search && !url.hash && (url.pathname === "/" || url.pathname === "") ? url.origin : null;
  } catch { return null; }
}

export function contentSecurityPolicy(nonce: string, development: boolean, oauthFormIssuer?: string): string {
  const privy = process.env.NEXT_PUBLIC_AUTH_PROVIDER === "privy";
  const oauthFormOrigin = safeOAuthFormOrigin(oauthFormIssuer);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // Existing financial reference bars and Next Image use inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self'",
    `connect-src 'self'${privy ? " https://auth.privy.io https://api.privy.io https://solana-mainnet.rpc.privy.systems" : ""}${development ? " ws: wss:" : ""}`,
    ...(privy ? ["frame-src https://auth.privy.io"] : []),
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self'${oauthFormOrigin ? ` ${oauthFormOrigin}` : ""}`,
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function baselineSecurityHeaders(production: boolean) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    // Also protects JSON/other responses outside the HTML nonce proxy matcher.
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'" },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
}
