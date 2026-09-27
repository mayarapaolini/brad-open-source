import type {
  AgentDefinition,
  AgentState,
  BradExport,
  Capability,
  ConsentGrant,
  DecisionRecord,
  ImportPlan,
  LifeContext,
  LifeDomainId,
  LifeMap,
  TransitionCheck,
} from "@brad/domain";
import type { ActionRequest, PolicyDecision } from "@brad/policy-engine";
import type { AnswerSyncReport, SyncReport } from "@brad/adapter-inkus";
import type { AgencyMetrics, FeedbackAction, FocusPlan, Load, ProposalFeedback, ShareSummary } from "@brad/secretary";
import type { Answer, AnswerInput, CatalogError, DomainPath, Question, SynthesisItem, Verdict } from "@brad/discovery";
import type { RankedItem, Suggestion, Tier } from "@brad/priority-engine";

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
  previewImport: (data: unknown) =>
    call<{ plan: ImportPlan; hash: string; alreadyImported: boolean }>("POST", "/api/import/preview", data),
  importData: (data: unknown, options: { timeZone?: string; force?: boolean } = {}) =>
    call<{ lifeMap: LifeMap; agents: AgentDefinition[]; grants: ConsentGrant[]; snapshotId: number }>("POST", "/api/import", {
      export: data,
      ...options,
    }),
  snapshots: () => call<{ snapshots: SnapshotInfo[] }>("GET", "/api/snapshots"),
  restoreSnapshot: (snapshotId: number, scope: RestoreScope = "all") =>
    call<{ lifeMap: LifeMap | null; agents: AgentDefinition[]; grants: ConsentGrant[]; snapshotId: number }>(
      "POST",
      "/api/snapshots/restore",
      { snapshotId, scope },
    ),
  simulatePriority: () => call<{ ranked: RankedItem[]; decisionId: number }>("POST", "/api/simulate/priority"),
  simulatePolicy: (body: { request: ActionRequest; assumeState?: AgentState; assumeGrant?: boolean; now?: string }) =>
    call<{ decision: PolicyDecision; decisionId: number }>("POST", "/api/simulate/policy", body),
  correct: (decisionId: number, itemId: string, expectedTier: Tier, note: string) =>
    call<{ correctionId: number; current: { score: number; tier: Tier }; suggestion: Suggestion | null }>(
      "POST",
      "/api/corrections",
      { decisionId, itemId, expectedTier, note },
    ),
  applyCorrection: (correctionId: number) =>
    call<{ lifeMap: LifeMap; suggestion: Suggestion }>("POST", "/api/corrections/apply", { correctionId }),
  updateAgent: (agentId: string, patch: Partial<Pick<AgentDefinition, "name" | "goal" | "responsibilities" | "domain" | "actionDomains" | "requestedCapabilities">>) =>
    call<{ agent: AgentDefinition; grants: ConsentGrant[] }>("POST", "/api/agents/update", { agentId, patch }),
  inkusStatus: () => call<{ enabled: boolean; interview: boolean; lastSync: DecisionRecord | null }>("GET", "/api/adapters/inkus"),
  setCatalogSource: (source: "builtin" | "inkus") => call<DiscoveryState>("POST", "/api/discovery/catalog", { source }),
  inkusQuestions: () => call<DiscoveryState>("POST", "/api/adapters/inkus/questions"),
  inkusAnswers: () => call<DiscoveryState>("POST", "/api/adapters/inkus/answers"),
  inkusSync: () =>
    call<{ report: SyncReport; decisionId: number; agents: AgentDefinition[]; grants: ConsentGrant[] }>(
      "POST",
      "/api/adapters/inkus/sync",
    ),
  inkusExport: (agentId: string) => call<{ agent: AgentDefinition }>("POST", "/api/adapters/inkus/export", { agentId }),
  discovery: () => call<DiscoveryState>("GET", "/api/discovery"),
  answer: (input: AnswerInput) => call<DiscoveryState>("POST", "/api/discovery/answers", input),
  confirmSynthesis: (itemId: string, verdict: Verdict, correction?: string) =>
    call<DiscoveryState>("POST", "/api/discovery/synthesis", { itemId, verdict, correction }),
  setAnswerSync: (answerId: string, syncToInkus: boolean, confirmSensitive = false) =>
    call<DiscoveryState>("POST", "/api/discovery/answers/sync", { answerId, syncToInkus, confirmSensitive }),
  secretary: () => call<SecretaryState>("GET", "/api/secretary"),
  proposalFeedback: (proposalId: string, action: FeedbackAction, note?: string) =>
    call<SecretaryState>("POST", "/api/secretary/feedback", { proposalId, action, note }),
  silence: (domain: LifeDomainId, silenced: boolean) => call<SecretaryState>("POST", "/api/secretary/silence", { domain, silenced }),
  checkin: (load: Load) => call<SecretaryState>("POST", "/api/secretary/checkin", { load }),
  secretaryContext: (context: LifeContext | "all") => call<SecretaryState>("POST", "/api/secretary/context", { context }),
  shareSummary: (audience: LifeContext, consents: LifeDomainId[]) =>
    call<ShareSummary>("POST", "/api/share/summary", { audience, consents }),
  getDecisions: () => call<{ decisions: DecisionRecord[] }>("GET", "/api/decisions"),
  reset: () => call<{ ok: true }>("DELETE", "/api/data"),
};

export type RestoreScope = "all" | "lifeMap" | "answers";

export interface SnapshotInfo {
  id: number;
  createdAt: string;
  reason: string;
  agents: number;
  grants: number;
  /** Null for versions saved before answers were kept. */
  answers: number | null;
  people: number;
  goals: number;
}

export interface DiscoveryState {
  catalog: {
    source: "builtin" | "inkus";
    version: string;
    fetchedAt: string | null;
    errors: CatalogError[];
    questions: Question[];
    lastLoad: { at: string; error: string | null } | null;
  };
  changed: string[];
  pendingSync: number;
  lastAnswerSync: { at: string; report: AnswerSyncReport } | null;
  estimate: number;
  domains: { domain: LifeDomainId; path: DomainPath; done: number; total: number; next: Question | null; closed: boolean }[];
  answers: Answer[];
  synthesis: (SynthesisItem & { correction: string | null })[];
}

export interface SecretaryState {
  context: LifeContext | "all";
  plan: FocusPlan;
  feedback: Record<string, ProposalFeedback>;
  metrics: AgencyMetrics;
  checkins: { at: string; load: Load }[];
  weeklyDue: boolean;
}
