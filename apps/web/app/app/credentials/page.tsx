import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrivyCredentials } from "@/components/privy/privy-credentials";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Credentials" };

export default function CredentialsPage() {
  if (!isPrivyMode()) notFound();
  return <PrivyCredentials />;
}
