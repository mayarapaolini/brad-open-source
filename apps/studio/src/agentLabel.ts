import type { AgentDefinition } from "@brad/domain";
import type { MessageKey } from "./i18n/en";

type T = (key: MessageKey, params?: Record<string, string | number | boolean>) => string;

/** An agent's display name: its own, or "<Domain> agent" for generated ones. */
export function agentLabel(t: T, agent: AgentDefinition): string {
  if (agent.name?.trim()) return agent.name;
  return agent.domain ? t("agents.name", { domain: t(`domain.${agent.domain}`) }) : t("agents.crossCutting");
}
