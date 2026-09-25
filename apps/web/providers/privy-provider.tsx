"use client";

import { PrivyProvider as Provider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { createPrivyClientConfig } from "@/lib/privy/client-config";
import { PRIVY_APP_ID } from "@/lib/privy/config";

const privyConfig = createPrivyClientConfig(PRIVY_APP_ID);

export function PrivyProvider({ children }: { children: ReactNode }) {
  return (
    <Provider appId={PRIVY_APP_ID} config={privyConfig}>
      {children}
    </Provider>
  );
}
