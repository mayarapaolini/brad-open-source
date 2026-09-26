import { validateLifeMap, type LifeMap } from "@brad/domain";
import { scoreItem, type RankedItem, type Tier } from "./index";

export type AdjustmentChange =
  | "allow_quiet_hours_bypass"
  | "remove_quiet_hours_bypass"
  | "raise_person_priority"
  | "lower_person_priority"
  | "raise_domain_importance"
  | "lower_domain_importance"
  | "add_person";

export interface Suggestion {
  change: AdjustmentChange;
  /** Values the change uses, so the interface can describe it in any language. */
  params: Record<string, string | number>;
  /** Score and tier the item would get after the change; null when the change is manual. */
  projected: { score: number; tier: Tier } | null;
}

const TIER_RANK: Record<Tier, number> = { later: 0, today: 1, now: 2 };

/** Returns a copy of the life map with the suggested change applied. */
export function applyAdjustment(map: LifeMap, suggestion: Suggestion): LifeMap {
  const next = structuredClone(map);
  const { change, params } = suggestion;
  const person = next.people.find((p) => p.id === params.personId);
  const assessment = next.assessments.find((a) => a.domain === params.domain);

  switch (change) {
    case "allow_quiet_hours_bypass":
    case "remove_quiet_hours_bypass":
      if (!person) throw new Error("person not found");
      person.bypassQuietHours = change === "allow_quiet_hours_bypass";
      break;
    case "raise_person_priority":
    case "lower_person_priority":
      if (!person) throw new Error("person not found");
      person.priority = Number(params.to);
      break;
    case "raise_domain_importance":
    case "lower_domain_importance":
      if (!assessment) throw new Error("domain not found");
      assessment.importance = Number(params.to);
      break;
    case "add_person":
      throw new Error("adding a person is a manual change");
  }

  const errors = validateLifeMap(next);
  if (errors.length > 0) throw new Error(`adjustment would produce an invalid life map: ${errors.join("; ")}`);
  return next;
}

/**
 * Turns "this should be <tier>" into one concrete, reversible life-map change, and projects
 * its effect. The first rule that fits wins, so the same feedback always gets the same answer.
 */
export function suggestAdjustment(ranked: RankedItem, expected: Tier, map: LifeMap): Suggestion | null {
  const diff = TIER_RANK[expected] - TIER_RANK[ranked.tier];
  if (diff === 0) return null;

  const item = ranked.item;
  const person = item.from.personId ? map.people.find((p) => p.id === item.from.personId) : undefined;
  const assessment = map.assessments.find((a) => a.domain === item.domain);
  const penalised = ranked.explanation.some((c) => c.rule === "quiet_hours");

  const candidate = ((): Omit<Suggestion, "projected"> | null => {
    if (diff > 0) {
      if (penalised && person && !person.bypassQuietHours)
        return { change: "allow_quiet_hours_bypass", params: { personId: person.id, name: person.name } };
      if (person && person.priority < 5)
        return {
          change: "raise_person_priority",
          params: { personId: person.id, name: person.name, from: person.priority, to: person.priority + 1 },
        };
      if (assessment && assessment.importance < 10)
        return {
          change: "raise_domain_importance",
          params: { domain: item.domain, from: assessment.importance, to: assessment.importance + 1 },
        };
      if (!person) return { change: "add_person", params: { address: item.from.address, domain: item.domain } };
      return null;
    }
    if (person && person.priority > 1)
      return {
        change: "lower_person_priority",
        params: { personId: person.id, name: person.name, from: person.priority, to: person.priority - 1 },
      };
    if (person?.bypassQuietHours)
      return { change: "remove_quiet_hours_bypass", params: { personId: person.id, name: person.name } };
    if (assessment && assessment.importance > 0)
      return {
        change: "lower_domain_importance",
        params: { domain: item.domain, from: assessment.importance, to: assessment.importance - 1 },
      };
    return null;
  })();

  if (!candidate) return null;
  if (candidate.change === "add_person") return { ...candidate, projected: null };
  const rescored = scoreItem(item, applyAdjustment(map, { ...candidate, projected: null }));
  return { ...candidate, projected: { score: rescored.score, tier: rescored.tier } };
}
