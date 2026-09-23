"use client";

import { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { MarketLoadingIndicator } from "./market-loading-indicator";

export function MarketDetailNavigationStatus({ symbol }: { symbol: string }) {
  const { pending } = useLinkStatus();
  if (!pending || typeof document === "undefined") return null;
  return createPortal(
    <div className="market-navigation-pending"><MarketLoadingIndicator label={`Loading ${symbol} details`} /></div>,
    document.body,
  );
}
