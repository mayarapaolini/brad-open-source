import type { AgentDefinition, LifeDomainId } from "./types";

/** Fills defaults for fields added after the first release, so older records keep working. */
export function normalizeAgent(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    origin: agent.origin ?? "generated",
    revision: agent.revision ?? 0,
    responsibilities: agent.responsibilities ?? [],
    actionDomains: agent.actionDomains ?? [],
  };
}

/** Domains an agent may act in: its own domain, or the listed ones for cross-cutting agents. */
export function agentActionDomains(agent: AgentDefinition): LifeDomainId[] {
  return agent.domain ? [agent.domain] : (agent.actionDomains ?? []);
}
