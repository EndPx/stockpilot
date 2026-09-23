"use client";

import Link from "next/link";
import { Activity, formatDate, LoadState, PageHeader, useControlList } from "./shared";

export function ActivityView() {
  const { items, error, reload } = useControlList<Activity>("/activity", "activity");
  return <div className="dashboard-stack"><PageHeader title="Activity" description="A record of client, credential, policy, request, and approval events for your account." />
    <section className="surface control-panel"><div className="surface-header"><h2>Recent events</h2><button type="button" className="secondary-button" onClick={reload}>Refresh</button></div>
      <LoadState items={items} error={error} retry={reload} empty="No agent activity yet." />
      {items && items.length > 0 && <div className="control-list">{items.map((item) => <article className="control-row" key={item.id}><div className="control-row-main"><strong>{item.eventType.replaceAll("_", " ").toLowerCase()}</strong><span>{item.clientName ?? "StockPilot"}{item.assetSymbol ? ` · ${item.assetSymbol}` : ""}{item.amountUsd ? ` · $${item.amountUsd} USDC` : ""}</span></div><span className="control-muted">{item.actorType.toLowerCase()} · {formatDate(item.createdAt)}</span>{item.requestId && <Link href={`/approvals/${item.requestId}`} className="secondary-button">View request</Link>}</article>)}</div>}
    </section>
  </div>;
}
