"use client";

import { PrivyCredentials } from "@/components/privy/privy-credentials";

// Keep this export stable while the old /credentials route redirects to /wallet.
export function CredentialsView() {
  return <PrivyCredentials />;
}
