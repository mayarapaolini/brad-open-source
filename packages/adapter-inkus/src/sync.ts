import type { AgentDefinition, Capability, ConsentGrant } from "@brad/domain";
import { agentFromInkus, applyInkusSpec, inkusAgentId, specFromAgent, type ContentField } from "./mapping";
import type { InkusClient } from "./types";

export interface SyncReport {
  imported: string[];
  updated: string[];
  /** Local edits replaced by a newer Inkus version (Inkus wins, by owner decision). */
  overwritten: { agentId: string; fields: ContentField[] }[];
  pushed: string[];
  created: string[];
  errors: { agentId: string | null; message: string }[];
}

export interface SyncInput {
  agents: AgentDefinition[];
  grants: ConsentGrant[];
  forbidden: Capability[];
  client: InkusClient;
  now: string;
  /** Display name for agents without one (generated agents are named after their domain). */
  displayName: (agent: AgentDefinition) => string;
}

export interface SyncResult {
  agents: AgentDefinition[];
  /** Grants whose capability the agent no longer requests; the caller revokes them. */
  revokeGrantIds: string[];
  report: SyncReport;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Two-way sync. Pull first: a newer active Inkus spec replaces the local content (state and
 * grants stay local). Then push: local edits and agents Inkus has not seen yet become new,
 * activated spec versions. Archived agents are neither pushed nor created.
 */
export async function syncWithInkus(input: SyncInput): Promise<SyncResult> {
  const { client, now, forbidden } = input;
  const report: SyncReport = { imported: [], updated: [], overwritten: [], pushed: [], created: [], errors: [] };
  const agents = new Map(input.agents.map((a) => [a.id, a]));
  const byActor = new Map(input.agents.filter((a) => a.inkus).map((a) => [a.inkus!.actorId, a.id]));
  const revokeGrantIds: string[] = [];

  // Pull.
  const actors = (await client.listActors()).filter((a) => a.type === "ai");
  for (const actor of actors) {
    try {
      const spec = await client.getActiveSpec(actor.id);
      if (!spec) continue;
      const localId = byActor.get(actor.id);
      const local = localId ? agents.get(localId) : undefined;
      if (!local) {
        const agent = agentFromInkus(actor, spec, now, forbidden);
        agents.set(agent.id, agent);
        byActor.set(actor.id, agent.id);
        report.imported.push(agent.id);
        continue;
      }
      if (local.inkus?.specId === spec.id) continue;
      const dirty = (local.revision ?? 0) > (local.inkus?.syncedRevision ?? 0);
      const { agent, changed } = applyInkusSpec(local, actor, spec, now, forbidden);
      agents.set(agent.id, agent);
      report.updated.push(agent.id);
      if (dirty && changed.length > 0) report.overwritten.push({ agentId: agent.id, fields: changed });
      for (const grant of input.grants) {
        if (grant.agentId === agent.id && grant.revokedAt === null && !agent.requestedCapabilities.includes(grant.capability)) {
          revokeGrantIds.push(grant.id);
        }
      }
    } catch (error) {
      report.errors.push({ agentId: byActor.get(actor.id) ?? inkusAgentId(actor.id), message: message(error) });
    }
  }

  // Push.
  for (const agent of agents.values()) {
    if (agent.state === "archived") continue;
    const revision = agent.revision ?? 0;
    const link = agent.inkus;
    if (link && revision <= link.syncedRevision) continue;
    try {
      const name = input.displayName(agent);
      let actorId = link?.actorId;
      if (!actorId) {
        actorId = (await client.createActor({ name, description: agent.goal || name })).id;
        report.created.push(agent.id);
      } else {
        report.pushed.push(agent.id);
      }
      const fields = specFromAgent(agent, name);
      const spec = await client.createSpec(actorId, fields);
      await client.activateSpec(spec.id);
      agents.set(agent.id, {
        ...agent,
        inkus: {
          actorId,
          specId: spec.id,
          specVersion: spec.version,
          syncedAt: now,
          syncedRevision: revision,
          passthrough: { ...(link?.passthrough ?? {}), capabilities: fields.capabilities, scope: fields.scope },
        },
      });
    } catch (error) {
      report.errors.push({ agentId: agent.id, message: message(error) });
    }
  }

  return { agents: [...agents.values()], revokeGrantIds, report };
}
