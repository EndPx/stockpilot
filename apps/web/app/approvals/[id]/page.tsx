import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApprovalDetailView } from "@/components/control-plane/approvals-view";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Review request" };
export default function ApprovalPage() { if (!isPrivyMode()) notFound(); return <ApprovalDetailView />; }
