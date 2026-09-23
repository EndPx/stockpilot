export function MarketLoadingIndicator({ label = "Loading markets" }: { label?: string }) {
  return (
    <div className="market-loading-indicator" role="status" aria-label={label}>
      <span className="market-loading-spinner" aria-hidden="true" />
      <span className="market-loading-label">{label}</span>
    </div>
  );
}
