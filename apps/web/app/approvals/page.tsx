import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApprovalsView } from "@/components/control-plane/approvals-view";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Approvals" };
export default function ApprovalsPage() { if (!isPrivyMode()) notFound(); return <ApprovalsView />; }
