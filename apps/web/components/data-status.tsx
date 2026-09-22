export function DataStatus({ fetchedAt, stale }: { fetchedAt: string; stale: boolean }) {
  const time = new Date(fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return (
    <div className="text-xs leading-6 text-muted">
      <p>Powered by PreStocks <span aria-hidden="true">·</span> Updated <time dateTime={fetchedAt}>{time} UTC</time></p>
      {stale && <p role="status" className="mt-2 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning">PreStocks is temporarily unavailable. Showing recently saved data; prices may have changed.</p>}
    </div>
  );
}
