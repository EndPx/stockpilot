"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { controlFetch } from "./shared";

export type ActivityDay = { date: string; activityCount: number; approvalCount: number };
type ActivityWeekState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; week: ActivityDay[] };
const weekdayFormatter = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });

function dayLabel(date: string): string {
  return weekdayFormatter.format(new Date(`${date}T12:00:00Z`));
}

export function ActivityWeekChart({ week }: { week: ActivityDay[] }) {
  const total = week.reduce((sum, day) => sum + day.activityCount + day.approvalCount, 0);
  const maximum = Math.max(1, ...week.map((day) => day.activityCount + day.approvalCount));
  return <div className="activity-week">
    <p className="activity-week-count"><strong>{total}</strong><span>events in the last 7 days · UTC</span></p>
    {total === 0 ? <p className="activity-week-empty">No activity in the last 7 days.</p> : <>
    <ol className="activity-week-bars" aria-label="Activity by UTC day">
      {week.map((day, index) => {
        const count = day.activityCount + day.approvalCount;
        return <li key={day.date}>
          <div className="activity-week-track" aria-hidden="true">
            {count > 0 && <div className="activity-week-bar" style={{ height: `${Math.max(10, count / maximum * 100)}%` }}>
              {day.approvalCount > 0 && <span className="activity-week-approvals" style={{ flexGrow: day.approvalCount }} />}
              {day.activityCount > 0 && <span className="activity-week-general" style={{ flexGrow: day.activityCount }} />}
            </div>}
          </div>
          <span className="activity-week-day" aria-hidden="true">{index === week.length - 1 ? "Today" : dayLabel(day.date)}</span>
          <span className="sr-only">{day.date}: {day.activityCount} other events, {day.approvalCount} approval events</span>
        </li>;
      })}
    </ol>
    <div className="activity-week-legend" aria-hidden="true"><span><i className="activity-legend-general" />Activity</span><span><i className="activity-legend-approvals" />Approvals</span></div>
    </>}
  </div>;
}

export function ActivityPreview() {
  const [state, setState] = useState<ActivityWeekState>({ kind: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    controlFetch<{ week: ActivityDay[] }>("/activity", "GET", undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState(Array.isArray(data.week) && data.week.length === 7
          ? { kind: "ready", week: data.week } : { kind: "error" });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ kind: "error" }); });
    return () => controller.abort();
  }, [revision]);

  return <section className="surface activity-preview" aria-labelledby="activity-preview-heading">
    <div className="surface-header">
      <h2 id="activity-preview-heading">Activity</h2>
      <Link href="/activity" className="text-link">View all <span aria-hidden="true">↗</span></Link>
    </div>
    {state.kind === "loading" ? <div className="activity-preview-state" role="status">Loading your activity…</div>
      : state.kind === "error" ? <div className="activity-preview-state" role="alert"><p>Activity is unavailable. No events have been replaced with zero.</p><button type="button" className="secondary-button" onClick={() => { setState({ kind: "loading" }); setRevision((value) => value + 1); }}>Try again</button></div>
        : <ActivityWeekChart week={state.week} />}
  </section>;
}
