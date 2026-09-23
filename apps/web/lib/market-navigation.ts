export function activeNavigationSection(pathname: string, group: string | null): string | null {
  if (pathname === "/app") return "overview";
  if (pathname.startsWith("/markets/xstocks/")) return "public";
  if (pathname.startsWith("/markets/") && pathname !== "/markets") return "private";
  if (pathname === "/markets") return group === "public" ? "public" : group === "all" ? null : "private";
  return null;
}
