import { isWithinQuietHours, type IncomingItem, type LifeMap } from "@brad/domain";

export type PriorityRule =
  | "declared_urgency"
  | "person_priority"
  | "unknown_sender"
  | "domain_weight"
  | "quiet_hours"
  | "quiet_hours_bypass";

export interface Contribution {
  rule: PriorityRule;
  points: number;
  /** Values the rule used, so the interface can explain it in any language. */
  params: Record<string, string | number | boolean>;
}

export type Tier = "now" | "today" | "later";

export interface RankedItem {
  item: IncomingItem;
  score: number;
  tier: Tier;
  explanation: Contribution[];
}

export const WEIGHTS = {
  urgency: 10,
  personPriority: 12,
  domainImportance: 2,
  domainGap: 2,
  quietHoursPenalty: -25,
} as const;

export const TIER_THRESHOLDS = { now: 80, today: 50 } as const;

export function scoreItem(item: IncomingItem, map: LifeMap): RankedItem {
  const explanation: Contribution[] = [];

  explanation.push({
    rule: "declared_urgency",
    points: item.urgency * WEIGHTS.urgency,
    params: { urgency: item.urgency },
  });

  const person = item.from.personId ? map.people.find((p) => p.id === item.from.personId) : undefined;
  if (person) {
    explanation.push({
      rule: "person_priority",
      points: person.priority * WEIGHTS.personPriority,
      params: { name: person.name, relationship: person.relationship, priority: person.priority },
    });
  } else {
    explanation.push({ rule: "unknown_sender", points: 0, params: { address: item.from.address } });
  }

  const assessment = map.assessments.find((a) => a.domain === item.domain);
  if (assessment) {
    const gap = Math.max(0, assessment.importance - assessment.satisfaction);
    explanation.push({
      rule: "domain_weight",
      points: assessment.importance * WEIGHTS.domainImportance + gap * WEIGHTS.domainGap,
      params: { domain: item.domain, importance: assessment.importance, gap },
    });
  }

  const { quietHours, timeZone } = map.boundaries;
  if (isWithinQuietHours(item.receivedAt, quietHours, timeZone)) {
    if (person?.bypassQuietHours) {
      explanation.push({ rule: "quiet_hours_bypass", points: 0, params: { name: person.name } });
    } else {
      explanation.push({
        rule: "quiet_hours",
        points: WEIGHTS.quietHoursPenalty,
        params: { start: quietHours?.start ?? "", end: quietHours?.end ?? "" },
      });
    }
  }

  const score = explanation.reduce((sum, c) => sum + c.points, 0);
  const tier: Tier = score >= TIER_THRESHOLDS.now ? "now" : score >= TIER_THRESHOLDS.today ? "today" : "later";
  return { item, score, tier, explanation };
}

/**
 * Ranks items by score. Ties go to the older item, then to the item id, so the
 * order never depends on input order or on the clock.
 */
export function rankItems(items: IncomingItem[], map: LifeMap): RankedItem[] {
  return items
    .map((item) => scoreItem(item, map))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(a.item.receivedAt) - Date.parse(b.item.receivedAt) ||
        a.item.id.localeCompare(b.item.id),
    );
}
