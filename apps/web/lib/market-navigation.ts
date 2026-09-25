export const marketSectionLabels = { private: "Pre-IPO", public: "Stocks" } as const;

export function activeNavigationSection(pathname: string, group: string | null): string | null {
  if (pathname === "/app") return "overview";
  if (pathname === "/wallet" || pathname === "/app/credentials" || pathname === "/credentials") return "wallet";
  if (pathname.startsWith("/clients")) return "clients";
  if (pathname.startsWith("/approvals")) return "approvals";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/markets/xstocks/")) return "public";
  if (pathname.startsWith("/markets/") && pathname !== "/markets") return "private";
  if (pathname === "/markets") return group === "public" ? "public" : group === "all" ? null : "private";
  return null;
}
