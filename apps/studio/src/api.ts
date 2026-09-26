import type {
  AgentDefinition,
  AgentState,
  BradExport,
  Capability,
  ConsentGrant,
  DecisionRecord,
  LifeMap,
  TransitionCheck,
} from "@brad/domain";
import type { ActionRequest, PolicyDecision } from "@brad/policy-engine";
import type { RankedItem } from "@brad/priority-engine";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new ApiError(json.error ?? res.statusText, json.details);
  return json as T;
}

export const api = {
  getLifeMap: () => call<{ lifeMap: LifeMap | null }>("GET", "/api/lifemap"),
  saveLifeMap: (lifeMap: LifeMap) => call<{ lifeMap: LifeMap }>("PUT", "/api/lifemap", { lifeMap }),
  loadDemo: () => call<{ lifeMap: LifeMap; agents: AgentDefinition[] }>("POST", "/api/demo/load"),
  getAgents: () => call<{ agents: AgentDefinition[]; grants: ConsentGrant[] }>("GET", "/api/agents"),
  generateAgents: () =>
    call<{ agents: AgentDefinition[]; grants: ConsentGrant[]; reset: string[]; archived: string[] }>(
      "POST",
      "/api/agents/generate",
    ),
  transition: (agentId: string, to: AgentState) =>
    call<{ result: TransitionCheck; agent: AgentDefinition }>("POST", "/api/agents/transition", { agentId, to }),
  grant: (agentId: string, capability: Capability, days = 30) =>
    call<{ grant: ConsentGrant }>("POST", "/api/grants", { agentId, capability, days }),
  revoke: (grantId: string) => call<{ grant: ConsentGrant }>("POST", "/api/grants/revoke", { grantId }),
  exportData: () => call<BradExport>("GET", "/api/export"),
  importData: (data: unknown) =>
    call<{ lifeMap: LifeMap; agents: AgentDefinition[]; grants: ConsentGrant[] }>("POST", "/api/import", data),
  simulatePriority: () => call<{ ranked: RankedItem[]; decisionId: number }>("POST", "/api/simulate/priority"),
  simulatePolicy: (body: { request: ActionRequest; assumeState?: AgentState; assumeGrant?: boolean; now?: string }) =>
    call<{ decision: PolicyDecision; decisionId: number }>("POST", "/api/simulate/policy", body),
  getDecisions: () => call<{ decisions: DecisionRecord[] }>("GET", "/api/decisions"),
  reset: () => call<{ ok: true }>("DELETE", "/api/data"),
};
