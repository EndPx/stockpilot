/** Premium of the token reference price to the issuer's mark price. */
export function marketPremium(tokenPrice: number | null, markPrice: number | null | undefined): number | null {
  if (tokenPrice == null || markPrice == null || !Number.isFinite(tokenPrice) || !Number.isFinite(markPrice) || tokenPrice <= 0 || markPrice <= 0) return null;
  const value = (tokenPrice / markPrice - 1) * 100;
  return Number.isFinite(value) ? value : null;
}

export function formatMarketPremium(value: number | null): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
