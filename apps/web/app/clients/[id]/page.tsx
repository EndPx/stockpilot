import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentDetailView } from "@/components/control-plane/agent-detail-view";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Agent details" };

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isPrivyMode()) notFound();
  const { id } = await params;
  return <AgentDetailView clientId={id} />;
}
