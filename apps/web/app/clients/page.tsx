import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientsView } from "@/components/control-plane/clients-view";
import { isPrivyMode } from "@/lib/privy/config";

export const metadata: Metadata = { title: "Agents" };
export default function ClientsPage() { if (!isPrivyMode()) notFound(); return <ClientsView />; }
