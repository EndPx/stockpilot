const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const valuation = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export function formatUsd(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : usd.format(value);
}

export function formatValuation(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : valuation.format(value);
}
