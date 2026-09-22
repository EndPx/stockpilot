import { RegistryQueryError, type RegistryPageFilter } from "@stockpilot/core/asset-registry";
export function parseMarketInputs(values: Record<string, string | string[] | undefined>): RegistryPageFilter {
  const single = (key: string) => { const value = values[key]; if (Array.isArray(value)) throw new RegistryQueryError("Use each filter once."); return value; };
  const query = single("q") ?? "";
  const group = single("group") ?? "all";
  const provider = single("provider");
  const marketType = single("marketType");
  const limit = single("limit");
  const cursor = single("cursor");
  if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query) || !["all", "private", "public"].includes(group) || provider && !["prestocks", "xstocks"].includes(provider) ||
      marketType && !["PRE_IPO", "PUBLIC_EQUITY", "ETF", "PUBLIC_MARKET_PRODUCT"].includes(marketType) ||
      limit !== undefined && (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) || cursor && cursor.length > 1600) throw new RegistryQueryError("Check your market filters.");
  return { query, group: group as RegistryPageFilter["group"], provider: provider as RegistryPageFilter["provider"], marketType: marketType as RegistryPageFilter["marketType"], limit: limit ? Number(limit) : 30, cursor };
}
export function marketHref(filter: RegistryPageFilter, cursor?: string | null) {
  const params = new URLSearchParams();
  if (filter.query) params.set("q", filter.query);
  if (filter.group && filter.group !== "all") params.set("group", filter.group);
  if (filter.provider) params.set("provider", filter.provider);
  if (filter.marketType) params.set("marketType", filter.marketType);
  if (cursor) params.set("cursor", cursor);
  return `/markets${params.size ? `?${params}` : ""}`;
}
export const marketLabels = { PRE_IPO: "Private market", PUBLIC_EQUITY: "Public equity", ETF: "ETF", PUBLIC_MARKET_PRODUCT: "Public-market product" } as const;
