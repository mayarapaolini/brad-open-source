import type { AgentDefinition, Capability, ConsentGrant, InkusLink } from "@brad/domain";
import { agentFromInkus, applyInkusSpec, domainFromSpec, inkusAgentId, specFromAgent, type ContentField } from "./mapping";
import type { InkusClient } from "./types";

export interface SyncReport {
  imported: string[];
  /** Brad agents linked to the Inkus agent of the same domain instead of importing a duplicate. */
  adopted: string[];
  updated: string[];
  /** Linked agents whose Inkus versions are all deprecated; archived locally, grants revoked. */
  retired: string[];
  /** Local edits replaced by a newer Inkus version (Inkus wins, by owner decision). */
  overwritten: { agentId: string; fields: ContentField[] }[];
  /** Local edits written to Inkus as new draft versions (not active until the owner activates them). */
  pushed: string[];
  /** Brad drafts the owner activated in Inkus since the last sync. */
  activated: string[];
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
 * Two-way sync. Pull first: a newer active or draft Inkus spec replaces the local content (state
 * and grants stay local); deprecated-only agents are retired; a Brad agent of the same domain is
 * linked instead of duplicated. Then push: local edits to linked agents become new **draft**
 * versions; Brad never activates them (ADR 0005). New Inkus agents are only created by
 * `exportAgentToInkus`.
 */
export async function syncWithInkus(input: SyncInput): Promise<SyncResult> {
  const { client, now, forbidden } = input;
  const report: SyncReport = {
    imported: [],
    adopted: [],
    updated: [],
    retired: [],
    overwritten: [],
    pushed: [],
    activated: [],
    errors: [],
  };
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

      // Deprecated versions are history, never something to load or run.
      if (spec.status === "deprecated") {
        if (local && local.state !== "archived") {
          agents.set(local.id, { ...local, state: "archived" });
          report.retired.push(local.id);
          for (const grant of input.grants) {
            if (grant.agentId === local.id && grant.revokedAt === null) revokeGrantIds.push(grant.id);
          }
        }
        continue;
      }

      if (!local) {
        // Link a Brad agent of the same domain rather than creating a duplicate.
        const domain = domainFromSpec(spec);
        const twin = domain
          ? [...agents.values()].find((a) => !a.inkus && a.domain === domain && a.state !== "archived")
          : undefined;
        if (twin) {
          const { agent } = applyInkusSpec(twin, actor, spec, now, forbidden);
          agents.set(agent.id, agent);
          byActor.set(actor.id, agent.id);
          report.adopted.push(agent.id);
          for (const grant of input.grants) {
            if (grant.agentId === agent.id && grant.revokedAt === null && !agent.requestedCapabilities.includes(grant.capability)) {
              revokeGrantIds.push(grant.id);
            }
          }
          continue;
        }
        const agent = agentFromInkus(actor, spec, now, forbidden);
        agents.set(agent.id, agent);
        byActor.set(actor.id, agent.id);
        report.imported.push(agent.id);
        continue;
      }
      const draft = local.inkus?.draft;
      if (draft && spec.id === draft.specId) {
        // Brad's own draft. If the owner activated it in Inkus, it is now the synced version.
        if (spec.status === "active") {
          agents.set(local.id, { ...local, inkus: settleDraft(local.inkus!, now) });
          report.activated.push(local.id);
        }
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

  // Push: only agents already linked to Inkus. Creating a new Inkus agent is an explicit owner action.
  for (const agent of agents.values()) {
    const link = agent.inkus;
    if (!link || agent.state === "archived") continue;
    const revision = agent.revision ?? 0;
    if (revision <= link.syncedRevision) continue;
    if (link.draft && link.draft.revision >= revision) continue; // already drafted
    try {
      agents.set(agent.id, await pushDraft(client, agent, input.displayName(agent), link.actorId, now));
      report.pushed.push(agent.id);
    } catch (error) {
      report.errors.push({ agentId: agent.id, message: message(error) });
    }
  }

  return { agents: [...agents.values()], revokeGrantIds, report };
}

/** The link once its draft is the active version. */
function settleDraft(link: InkusLink, now: string): InkusLink {
  const { draft, ...rest } = link;
  if (!draft) return link;
  return { ...rest, specId: draft.specId, specVersion: draft.specVersion, syncedRevision: draft.revision, syncedAt: now };
}

/** Writes the agent's current content as a new draft version. The active version is untouched. */
export async function pushDraft(
  client: InkusClient,
  agent: AgentDefinition,
  name: string,
  actorId: string,
  now: string,
): Promise<AgentDefinition> {
  const fields = specFromAgent(agent, name);
  const spec = await client.createSpec(actorId, fields);
  const draft = { specId: spec.id, specVersion: spec.version, revision: agent.revision ?? 0, createdAt: now };
  const passthrough = { ...(agent.inkus?.passthrough ?? {}), capabilities: fields.capabilities, scope: fields.scope };
  // A brand-new actor has no active version yet: its first draft is also what Brad reads back.
  const link: InkusLink = agent.inkus
    ? { ...agent.inkus, passthrough, draft }
    : { actorId, specId: spec.id, specVersion: spec.version, syncedAt: now, syncedRevision: draft.revision, passthrough, draft };
  return { ...agent, inkus: link };
}

/**
 * Activates the draft Brad wrote, on an explicit owner action. Inkus deprecates the previous
 * active version; Hermes starts using the new one.
 */
export async function activateDraft(client: InkusClient, agent: AgentDefinition, now: string): Promise<AgentDefinition> {
  const draft = agent.inkus?.draft;
  if (!agent.inkus || !draft) throw new Error("agent has no draft in Inkus");
  await client.activateSpec(draft.specId);
  return { ...agent, inkus: settleDraft(agent.inkus, now) };
}

/**
 * Creates an Inkus actor for a Brad agent that has none, with a first **draft** version.
 * Only called on an explicit owner action, never during a sync.
 */
export async function exportAgentToInkus(
  client: InkusClient,
  agent: AgentDefinition,
  name: string,
  now: string,
): Promise<AgentDefinition> {
  if (agent.inkus) throw new Error("agent is already linked to Inkus");
  const actor = await client.createActor({ name, description: agent.goal || name });
  return pushDraft(client, agent, name, actor.id, now);
}
