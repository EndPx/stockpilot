"use client";

import Link from "next/link";
import { Activity, formatDate, useControlList } from "./shared";

export function ActivityPreview() {
  const { items, error, reload } = useControlList<Activity>("/activity", "activity");
  return <section className="surface activity-preview" aria-labelledby="activity-preview-heading">
    <div className="surface-header">
      <h2 id="activity-preview-heading">Activity</h2>
      <Link href="/activity" className="text-link">View all <span aria-hidden="true">↗</span></Link>
    </div>
    {error ? <div className="activity-preview-state" role="alert"><p>Activity is unavailable. No events have been hidden or replaced.</p><button type="button" className="secondary-button" onClick={reload}>Try again</button></div>
      : !items ? <div className="activity-preview-state" role="status">Loading recent activity…</div>
        : items.length === 0 ? <div className="activity-preview-state"><p>No agent activity yet.</p><p>Client and approval events will appear here.</p></div>
          : <ol className="activity-preview-list">{items.slice(0, 5).map((item) => <li key={item.id}>
            <span className="activity-preview-marker" aria-hidden="true" />
            <div><strong>{item.eventType.replaceAll("_", " ").toLowerCase()}</strong><p>{item.clientName ?? "StockPilot"}{item.assetSymbol ? ` · ${item.assetSymbol}` : ""}</p><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div>
          </li>)}</ol>}
  </section>;
}
