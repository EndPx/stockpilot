import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CredentialsView } from "@/components/control-plane/credentials-view";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Credentials" };
export default function CredentialsPage() { if (!isPrivyMode()) notFound(); return <CredentialsView />; }
