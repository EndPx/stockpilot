"use client";

import { useState } from "react";

export function AssetLogo({ imageUrl, symbol, large = false }: { imageUrl: string | null; symbol: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white font-semibold text-slate-600 ${large ? "h-16 w-16 text-xl" : "h-11 w-11 text-sm"}`}>
      {imageUrl && !failed ? (
        <img src={imageUrl} alt="" width={large ? 64 : 44} height={large ? 64 : 44} className="h-full w-full object-contain p-1.5" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : <span aria-hidden="true">{symbol.slice(0, 2)}</span>}
    </span>
  );
}
