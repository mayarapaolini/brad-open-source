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
    };
    return [{ agent, weight: a.importance + Math.max(0, gap) }];
  });

  return candidates
    .sort(
      (x, y) =>
        y.weight - x.weight || LIFE_DOMAINS.indexOf(x.agent.domain) - LIFE_DOMAINS.indexOf(y.agent.domain),
    )
    .map((c) => c.agent);
}
