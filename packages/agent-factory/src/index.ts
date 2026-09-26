import {
  LIFE_DOMAINS,
  type AgentDefinition,
  type AgentReason,
  type Capability,
  type LifeDomainId,
  type LifeMap,
} from "@brad/domain";

/** A domain gets an agent when it matters this much... */
export const IMPORTANCE_THRESHOLD = 6;
/** ...or when importance exceeds satisfaction by at least this much. */
export const GAP_THRESHOLD = 3;

/** Capabilities each domain's agent would need. Nothing here is granted automatically. */
export const DOMAIN_CAPABILITIES: Record<LifeDomainId, Capability[]> = {
  family: ["read_messages", "draft_reply", "read_calendar", "send_message"],
  work: ["read_messages", "draft_reply", "read_calendar", "create_event"],
  study: ["read_calendar", "read_notes", "create_event"],
  health: ["read_calendar", "create_event"],
  finances: ["read_messages", "make_payment"],
  home: ["read_calendar", "create_event", "delete_item"],
  social: ["read_messages", "draft_reply", "read_calendar"],
  leisure: ["read_calendar", "create_event"],
  growth: ["read_notes"],
  contribution: ["read_calendar"],
};

/**
 * Proposes one draft agent per life domain that needs attention.
 * Deterministic: the same life map always yields the same agents in the same order.
 */
export function generateDraftAgents(map: LifeMap): AgentDefinition[] {
  const forbidden = new Set(map.boundaries.forbiddenCapabilities);
  const candidates = map.assessments.flatMap((a) => {
    const gap = a.importance - a.satisfaction;
    const important = a.importance >= IMPORTANCE_THRESHOLD;
    const neglected = gap >= GAP_THRESHOLD;
    if (!important && !neglected) return [];
    const reason: AgentReason = important && neglected ? "importance_and_gap" : important ? "importance" : "gap";
    const wanted = DOMAIN_CAPABILITIES[a.domain];
    const agent: AgentDefinition = {
      id: `agent-${a.domain}`,
      domain: a.domain,
      state: "draft",
      goal: a.goal,
      reason,
      requestedCapabilities: wanted.filter((c) => !forbidden.has(c)),
      excludedByBoundary: wanted.filter((c) => forbidden.has(c)),
      escalation: "ask_owner",
      origin: "generated",
      revision: 0,
    };
    return [{ agent, domain: a.domain, weight: a.importance + Math.max(0, gap) }];
  });

  return candidates
    .sort(
      (x, y) =>
        y.weight - x.weight || LIFE_DOMAINS.indexOf(x.domain) - LIFE_DOMAINS.indexOf(y.domain),
    )
    .map((c) => c.agent);
}

export interface ReconcileResult {
  agents: AgentDefinition[];
  /** Agents whose requested capabilities changed and were sent back for review. */
  reset: string[];
  /** Agents the life map no longer justifies. */
  archived: string[];
}

function sameCapabilities(a: Capability[], b: Capability[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/**
 * Regenerating agents must not erase the owner's decisions. Existing agents keep their
 * state; if what they need changed, anything past "configured" goes back to "configured"
 * for review. Agents the new life map no longer proposes are archived, never deleted.
 */
export function reconcileAgents(existing: AgentDefinition[], proposed: AgentDefinition[]): ReconcileResult {
  const reset: string[] = [];
  const archived: string[] = [];
  // Imported agents (e.g. from Inkus) belong to the owner, not to the life-map generator.
  const imported = existing.filter((a) => (a.origin ?? "generated") !== "generated");
  const generated = existing.filter((a) => (a.origin ?? "generated") === "generated");
  const byId = new Map(generated.map((a) => [a.id, a]));

  const agents = proposed.map((next) => {
    const prev = byId.get(next.id);
    if (!prev) return next;
    const changed = !sameCapabilities(prev.requestedCapabilities, next.requestedCapabilities);
    // Keep the Inkus link and count the change as a local edit, so the next sync pushes it.
    const kept = {
      ...next,
      inkus: prev.inkus,
      revision: (prev.revision ?? 0) + (changed || prev.goal !== next.goal ? 1 : 0),
    };
    if (prev.state === "archived" || prev.state === "draft") return kept;
    if (changed && prev.state !== "configured") reset.push(next.id);
    return { ...kept, state: changed ? "configured" : prev.state };
  });

  const proposedIds = new Set(proposed.map((a) => a.id));
  for (const prev of generated) {
    if (proposedIds.has(prev.id)) continue;
    if (prev.state !== "archived") archived.push(prev.id);
    agents.push({ ...prev, state: "archived" });
  }
  return { agents: [...agents, ...imported], reset, archived };
}
