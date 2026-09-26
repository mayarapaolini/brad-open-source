import type { AgentDefinition, ConsentGrant, LifeMap } from "./types";
import { validateAgent, validateGrant, validateLifeMap } from "./validate";

export const EXPORT_FORMAT = "brad-export";

/** Portable snapshot of a person's Brad setup. Decision history stays on the machine. */
export interface BradExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  lifeMap: LifeMap;
  agents: AgentDefinition[];
  grants: ConsentGrant[];
}

export function validateExport(input: unknown): string[] {
  const e = input as Partial<BradExport> | null;
  if (typeof e !== "object" || e === null) return ["export must be an object"];
  if (e.format !== EXPORT_FORMAT) return [`format must be "${EXPORT_FORMAT}"`];
  if (e.version !== 1) return ["version must be 1"];
  const errors = validateLifeMap(e.lifeMap).map((m) => `lifeMap: ${m}`);
  if (!Array.isArray(e.agents)) errors.push("agents must be an array");
  else e.agents.forEach((a, i) => errors.push(...validateAgent(a, `agents[${i}]`)));
  if (!Array.isArray(e.grants)) errors.push("grants must be an array");
  else e.grants.forEach((g, i) => errors.push(...validateGrant(g, `grants[${i}]`)));
  if (errors.length === 0) {
    const ids = new Set(e.agents!.map((a) => a.id));
    if (ids.size !== e.agents!.length) errors.push("agents contain duplicate ids");
    e.grants!.forEach((g, i) => {
      if (!ids.has(g.agentId)) errors.push(`grants[${i}].agentId does not match any agent`);
    });
  }
  return errors;
}
