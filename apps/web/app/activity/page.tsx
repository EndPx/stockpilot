import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityView } from "@/components/control-plane/activity-view";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Activity" };
export default function ActivityPage() { if (!isPrivyMode()) notFound(); return <ActivityView />; }
