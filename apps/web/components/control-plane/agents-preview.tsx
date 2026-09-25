"use client";

import Link from "next/link";
import { AgentMark } from "./clients-view";
import { agentConnectionLabel } from "./agent-labels";
import { ClientRecord, formatDate, useControlList } from "./shared";

export function AgentsPreviewList({ active }: { active: ClientRecord[] }) {
  return <div className="agents-preview-content"><p className="agents-preview-count">{active.length} active {active.length === 1 ? "agent" : "agents"}</p><ul>
    {active.slice(0, 3).map((client) => <li key={client.id}><Link href={`/clients/${client.id}`}>
      <AgentMark name={client.name} />
      <span className="agents-preview-identity"><strong>{client.name}</strong><small>{agentConnectionLabel(client)} · {client.lastUsedAt ? `Last used ${formatDate(client.lastUsedAt)}` : "Not used yet"}</small></span>
      <span className="agents-preview-arrow" aria-hidden="true">↗</span>
    </Link></li>)}
  </ul></div>;
}

export function AgentsPreview() {
  const { items, error, reload } = useControlList<ClientRecord>("/clients", "clients");
  const active = items?.filter((client) => client.status === "ACTIVE" && client.authMethods.length > 0) ?? [];
  return <section className="surface agents-preview" aria-labelledby="agents-preview-heading">
    <div className="surface-header"><h2 id="agents-preview-heading">Agents</h2><Link href="/clients" className="text-link">View all <span aria-hidden="true">↗</span></Link></div>
    {error ? <div className="agents-preview-state" role="alert"><p>Agents are unavailable right now.</p><button type="button" className="secondary-button" onClick={reload}>Try again</button></div>
      : !items ? <div className="agents-preview-state" role="status">Loading connected agents…</div>
        : active.length === 0 ? <div className="agents-preview-state"><p>No active agents yet.</p><Link href="/clients" className="secondary-button">Connect an agent</Link></div>
          : <AgentsPreviewList active={active} />}
  </section>;
}
