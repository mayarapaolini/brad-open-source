import {
  CONSEQUENTIAL_CAPABILITIES,
  agentActionDomains,
  agentContexts,
  domainContext,
  isBridged,
  isGrantValid,
  type AgentDefinition,
  type AgentState,
  type Boundaries,
  type Capability,
  type ConsentGrant,
  type LifeDomainId,
} from "@brad/domain";

export interface ActionRequest {
  agentId: string;
  capability: Capability;
  domain: LifeDomainId;
}

export interface PolicyContext {
  agents: AgentDefinition[];
  grants: ConsentGrant[];
  boundaries: Boundaries;
  /** ISO 8601 instant the request is evaluated at. */
  now: string;
}

export type Outcome = "allow" | "deny" | "confirm";

export type PolicyRule =
  | "agent_known"
  | "forbidden_capability"
  | "agent_state"
  | "domain_scope"
  | "context_boundary"
  | "grant_present"
  | "grant_valid"
  | "sensitive_domain"
  | "consequential_action";

export interface TraceStep {
  rule: PolicyRule;
  status: "pass" | "fail" | "flag" | "skipped";
  params: Record<string, string>;
}

export interface PolicyDecision {
  outcome: Outcome;
  /** The rule that settled the outcome. */
  decidedBy: PolicyRule | "all_rules_passed";
  trace: TraceStep[];
}

/** Rules are always evaluated in this order. */
export const RULE_ORDER: readonly PolicyRule[] = [
  "agent_known",
  "forbidden_capability",
  "agent_state",
  "domain_scope",
  "context_boundary",
  "grant_present",
  "grant_valid",
  "sensitive_domain",
  "consequential_action",
];

const EXECUTABLE_STATES: readonly AgentState[] = ["approved", "active"];

/**
 * Deterministic policy evaluation. Denies by default: an action is allowed only when
 * every rule passes, and a rule that flags turns the outcome into "confirm".
 * No LLM, clock or network is involved; `now` comes from the caller.
 */
export function evaluate(request: ActionRequest, ctx: PolicyContext): PolicyDecision {
  const trace: TraceStep[] = [];
  const agent = ctx.agents.find((a) => a.id === request.agentId);
  const now = Date.parse(ctx.now);
  // Prefer a currently valid grant, so an old revoked one never hides a new one.
  const matching = ctx.grants.filter((g) => g.agentId === request.agentId && g.capability === request.capability);
  const grant = matching.find((g) => isGrantValid(g, ctx.now)) ?? matching.at(-1);

  type StepResult = Omit<TraceStep, "rule">;
  const checks: Record<PolicyRule, () => StepResult> = {
    agent_known: (): StepResult =>
      agent ? { status: "pass", params: { agentId: request.agentId } } : { status: "fail", params: { agentId: request.agentId } },
    forbidden_capability: (): StepResult => ({
      status: ctx.boundaries.forbiddenCapabilities.includes(request.capability) ? "fail" : "pass",
      params: { capability: request.capability },
    }),
    agent_state: (): StepResult => ({
      status: agent && EXECUTABLE_STATES.includes(agent.state) ? "pass" : "fail",
      params: { state: agent?.state ?? "unknown" },
    }),
    domain_scope: (): StepResult => {
      // Cross-cutting agents (no domain) may only act where the owner listed them.
      const allowed = agent ? agentActionDomains(agent) : [];
      return {
        status: allowed.includes(request.domain) ? "pass" : "fail",
        params: {
          agentDomain: agent?.domain ?? (agent ? "cross_cutting" : "unknown"),
          requestDomain: request.domain,
        },
      };
    },
    context_boundary: (): StepResult => {
      // Personal and work stay apart: an agent acting in both needs an explicit owner bridge.
      const requestContext = domainContext(ctx.boundaries, request.domain);
      const contexts = agent ? agentContexts(agent, ctx.boundaries) : [];
      const bridged = agent ? isBridged(agent, ctx.boundaries) : false;
      const crosses = contexts.some((c) => c !== requestContext);
      return {
        status: crosses && !bridged ? "fail" : "pass",
        params: { agentContext: contexts.join("+") || "none", requestContext, bridged: String(bridged) },
      };
    },
    grant_present: (): StepResult =>
      grant
        ? { status: "pass", params: { grantId: grant.id } }
        : { status: "fail", params: { capability: request.capability } },
    grant_valid: (): StepResult => {
      if (!grant) return { status: "fail", params: {} };
      if (grant.revokedAt !== null) return { status: "fail", params: { reason: "revoked", at: grant.revokedAt } };
      if (Date.parse(grant.issuedAt) > now) return { status: "fail", params: { reason: "not_yet_valid", at: grant.issuedAt } };
      if (Date.parse(grant.expiresAt) <= now) return { status: "fail", params: { reason: "expired", at: grant.expiresAt } };
      return { status: "pass", params: { expiresAt: grant.expiresAt } };
    },
    sensitive_domain: (): StepResult => ({
      status: ctx.boundaries.sensitiveDomains.includes(request.domain) ? "flag" : "pass",
      params: { domain: request.domain },
    }),
    consequential_action: (): StepResult => ({
      status: CONSEQUENTIAL_CAPABILITIES.includes(request.capability) ? "flag" : "pass",
      params: { capability: request.capability },
    }),
  };

  let denial: PolicyRule | null = null;
  let flag: PolicyRule | null = null;
  for (const rule of RULE_ORDER) {
    if (denial) {
      trace.push({ rule, status: "skipped", params: {} });
      continue;
    }
    const step = { rule, ...checks[rule]() };
    trace.push(step);
    if (step.status === "fail") denial = rule;
    if (step.status === "flag" && !flag) flag = rule;
  }

  if (denial) return { outcome: "deny", decidedBy: denial, trace };
  if (flag) return { outcome: "confirm", decidedBy: flag, trace };
  return { outcome: "allow", decidedBy: "all_rules_passed", trace };
}
