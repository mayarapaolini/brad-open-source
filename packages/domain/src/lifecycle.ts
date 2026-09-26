import type { AgentDefinition, AgentState, ConsentGrant } from "./types";

/** Every state change an owner may make. Anything else is refused. */
export const ALLOWED_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  draft: ["configured", "archived"],
  configured: ["simulated", "draft", "archived"],
  simulated: ["approved", "configured", "archived"],
  approved: ["active", "configured", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

export type TransitionBlock =
  | "not_allowed"
  | "missing_goal"
  | "no_capabilities"
  | "not_simulated"
  | "no_valid_grant";

export interface TransitionContext {
  grants: ConsentGrant[];
  /** Whether the owner has run at least one policy simulation for this agent. */
  hasSimulation: boolean;
  now: string;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: TransitionBlock; params: Record<string, string> };

export function isGrantValid(grant: ConsentGrant, now: string): boolean {
  const t = Date.parse(now);
  return grant.revokedAt === null && Date.parse(grant.issuedAt) <= t && Date.parse(grant.expiresAt) > t;
}

/**
 * Decides whether an agent may move to `to`. An agent only becomes active once it has
 * a goal, requested capabilities, a policy simulation the owner has seen, and a valid grant.
 */
export function checkTransition(agent: AgentDefinition, to: AgentState, ctx: TransitionContext): TransitionCheck {
  if (!ALLOWED_TRANSITIONS[agent.state].includes(to)) {
    return { ok: false, reason: "not_allowed", params: { from: agent.state, to } };
  }
  const advancing = to === "configured" || to === "simulated" || to === "approved" || to === "active";
  if (advancing && agent.goal.trim() === "") return { ok: false, reason: "missing_goal", params: {} };
  if (advancing && agent.requestedCapabilities.length === 0) return { ok: false, reason: "no_capabilities", params: {} };
  if ((to === "simulated" || to === "approved" || to === "active") && !ctx.hasSimulation) {
    return { ok: false, reason: "not_simulated", params: {} };
  }
  if (to === "active" && !ctx.grants.some((g) => g.agentId === agent.id && isGrantValid(g, ctx.now))) {
    return { ok: false, reason: "no_valid_grant", params: {} };
  }
  return { ok: true };
}
