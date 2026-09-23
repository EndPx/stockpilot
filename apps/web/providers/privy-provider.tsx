"use client";

import { PrivyProvider as Provider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { PRIVY_APP_ID } from "@/lib/privy/config";

export function PrivyProvider({ children }: { children: ReactNode }) {
  return (
    <Provider appId={PRIVY_APP_ID} config={{
      loginMethods: ["google", "email"],
      embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
      appearance: { theme: "dark", accentColor: "#5468ff" },
    }}>
      {children}
    </Provider>
  );
}
