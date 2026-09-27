import { agentActionDomains } from "./agent";
import { DEFAULT_WORK_DOMAINS, type AgentDefinition, type Boundaries, type LifeContext, type LifeDomainId } from "./types";

export function workDomains(boundaries: Boundaries): readonly LifeDomainId[] {
  return boundaries.workDomains ?? DEFAULT_WORK_DOMAINS;
}

/** Which context a life domain belongs to: work for the owner's work domains, personal otherwise. */
export function domainContext(boundaries: Boundaries, domain: LifeDomainId): LifeContext {
  return workDomains(boundaries).includes(domain) ? "work" : "personal";
}

/** The contexts an agent's action domains fall in (empty for a cross-cutting agent with no domains). */
export function agentContexts(agent: AgentDefinition, boundaries: Boundaries): LifeContext[] {
  const contexts = new Set(agentActionDomains(agent).map((d) => domainContext(boundaries, d)));
  return (["personal", "work"] as const).filter((c) => contexts.has(c));
}

export function isBridged(agent: AgentDefinition, boundaries: Boundaries): boolean {
  return (boundaries.contextBridges ?? []).includes(agent.id);
}
