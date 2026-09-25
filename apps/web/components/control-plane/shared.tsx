"use client";

import { useCallback, useEffect, useState } from "react";

export type ClientRecord = {
  id: string; name: string; clientType: string; status: string; createdAt: string;
  lastUsedAt: string | null; expiresAt: string | null; oauthConnectedAt: string | null;
  oauthRevokedAt: string | null;
  authMethods: Array<"oauth" | "api_key">; scopes: string[];
};
export type Policy = {
  clientId: string; approvalMode: string; scopes: string[];
  buyMode: "DISABLED" | "APPROVAL" | "AUTO";
  sellMode: "DISABLED" | "APPROVAL" | "AUTO";
  maxInvestmentUsd: string | null;
  dailyRequestLimitUsd: string | null; allowedProviders: string[]; allowedMarketTypes: string[];
  version: number; updatedAt: string;
};
export type Credential = {
  id: string; clientId: string; clientName: string; displayPrefix: string;
  status: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null;
};
export type Approval = {
  id: string; clientId: string; clientName: string; assetName: string; assetSymbol: string;
  canonicalMint: string; amountUsd: string; status: string; provider: string;
  marketType: string; policyVersion: number; policyMaxInvestmentUsd: string | null;
  createdAt: string; expiresAt: string; decidedAt: string | null;
};
export type Activity = {
  id: string; eventType: string; actorType: string; clientName: string | null;
  requestId: string | null; assetSymbol: string | null; amountUsd: string | null;
  createdAt: string;
};

export async function controlFetch<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/control${path}`, {
    method, credentials: "same-origin", cache: "no-store", signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "The control plane is unavailable. Try again.");
  return result;
}

export function useControlList<T>(path: string, key: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    controlFetch<Record<string, T[]>>(path, "GET", undefined, controller.signal)
      .then((data) => { if (!controller.signal.aborted) { setItems(data[key] ?? []); setError(""); } })
      .catch((cause) => { if (!controller.signal.aborted) { setItems(null); setError(cause instanceof Error ? cause.message : "Unable to load data."); } });
    return () => controller.abort();
  }, [path, key, revision]);
  return { items, error, reload };
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <header className="app-page-header control-header"><div><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div>{action}</header>;
}

export function LoadState({ items, error, retry, empty }: { items: unknown[] | null; error: string; retry: () => void; empty: string }) {
  if (error) return <section className="surface control-state" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={retry}>Try again</button></section>;
  if (!items) return <section className="surface control-state" role="status">Loading…</section>;
  if (items.length === 0) return <section className="surface control-state"><p>{empty}</p></section>;
  return null;
}

export function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}
