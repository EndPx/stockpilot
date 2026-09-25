"use client";

import { useEffect } from "react";

/** Local packages only; never load browser instrumentation in production. */
export function DevReactTools() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS === "1") return;
    void import("react-grab");
    void import("react-scan").then(({ scan }) => scan());
  }, []);
  return null;
}
