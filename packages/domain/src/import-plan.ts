import type { BradExport } from "./export";
import type { AgentDefinition, ConsentGrant, LifeDomainId, LifeMap, Person } from "./types";

export interface CurrentState {
  lifeMap: LifeMap | null;
  agents: AgentDefinition[];
  grants: ConsentGrant[];
}

export interface AssessmentChange {
  domain: LifeDomainId;
  before: { satisfaction: number; importance: number; goal: string } | null;
  after: { satisfaction: number; importance: number; goal: string };
}

export type ImportWarning =
  | { code: "timezone_utc" }
  | { code: "active_agents_paused"; agentIds: string[] }
  | { code: "grants_present"; count: number }
  | { code: "replaces_local_data" };

export interface ImportPlan {
  /** Nothing would change. */
  identical: boolean;
  assessments: AssessmentChange[];
  people: { added: string[]; removed: string[]; changed: string[] };
  boundariesChanged: boolean;
  timeZone: { from: string | null; to: string };
  agents: { added: string[]; removed: string[]; updated: string[] };
  grants: { added: number; removed: number };
  warnings: ImportWarning[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]));
}

function diffIds<T extends { id: string }>(before: T[], after: T[]) {
  const b = byId(before);
  const a = byId(after);
  return {
    added: [...a.keys()].filter((id) => !b.has(id)),
    removed: [...b.keys()].filter((id) => !a.has(id)),
    changed: [...a.keys()].filter((id) => b.has(id) && !same(b.get(id), a.get(id))),
  };
}

/**
 * What importing `incoming` would change, without changing anything. Pure and deterministic,
 * so the Studio can show it as a preview and tests can pin it down.
 */
export function planImport(current: CurrentState, incoming: BradExport): ImportPlan {
  const before = current.lifeMap;
  const after = incoming.lifeMap;

  const assessments: AssessmentChange[] = after.assessments
    .map((a) => {
      const prev = before?.assessments.find((p) => p.domain === a.domain);
      const pick = (x: { satisfaction: number; importance: number; goal: string }) => ({
        satisfaction: x.satisfaction,
        importance: x.importance,
        goal: x.goal,
      });
      return { domain: a.domain, before: prev ? pick(prev) : null, after: pick(a) };
    })
    .filter((c) => !same(c.before, c.after));

  const people = diffIds<Person>(before?.people ?? [], after.people);
  const agents = diffIds(current.agents, incoming.agents);
  const grants = diffIds(current.grants, incoming.grants);

  const warnings: ImportWarning[] = [];
  if (after.boundaries.timeZone === "UTC") warnings.push({ code: "timezone_utc" });
  const active = incoming.agents.filter((a) => a.state === "active").map((a) => a.id);
  if (active.length > 0) warnings.push({ code: "active_agents_paused", agentIds: active });
  if (incoming.grants.length > 0) warnings.push({ code: "grants_present", count: incoming.grants.length });

  const boundariesChanged = !same(before?.boundaries ?? null, after.boundaries);
  const identical =
    before !== null &&
    same(before, after) &&
    agents.added.length + agents.removed.length + agents.changed.length === 0 &&
    grants.added.length + grants.removed.length + grants.changed.length === 0;
  if (!identical && (before !== null || current.agents.length > 0)) warnings.push({ code: "replaces_local_data" });

  return {
    identical,
    assessments,
    people: { added: people.added, removed: people.removed, changed: people.changed },
    boundariesChanged,
    timeZone: { from: before?.boundaries.timeZone ?? null, to: after.boundaries.timeZone },
    agents: { added: agents.added, removed: agents.removed, updated: agents.changed },
    grants: { added: grants.added.length, removed: grants.removed.length },
    warnings,
  };
}

/** Applies the owner's time-zone choice. Quiet hours are local times and are kept as written. */
export function withTimeZone(map: LifeMap, timeZone: string): LifeMap {
  return { ...map, boundaries: { ...map.boundaries, timeZone } };
}

/** Dates every assessment that has no date yet with the export time. */
export function datedAssessments(map: LifeMap, asOf: string): LifeMap {
  return {
    ...map,
    assessments: map.assessments.map((a) => ({ ...a, asOf: a.asOf ?? asOf, source: a.source ?? "self_reported" })),
  };
}
