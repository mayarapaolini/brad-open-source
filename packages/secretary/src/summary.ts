import { LIFE_DOMAINS, domainContext, type LifeContext, type LifeDomainId, type LifeMap } from "@brad/domain";
import { planFocus, type Proposal, type ProposalAction, type ProposalFeedback } from "./index";

export type ExclusionReason = "other_context" | "sensitive" | "silenced";

export interface SummaryLine {
  domain: LifeDomainId;
  goal: string;
  /** The focus Brad and the owner agreed on for this area, if it is in the current plan. */
  focus: ProposalAction | null;
  protected: boolean;
}

export interface ShareSummary {
  audience: LifeContext;
  lines: SummaryLine[];
  excluded: { domain: LifeDomainId; reason: ExclusionReason }[];
}

/** Only proposals whose area belongs to the given context. */
export function inContext(map: LifeMap, proposals: Proposal[], context: LifeContext | "all"): Proposal[] {
  return context === "all" ? proposals : proposals.filter((p) => domainContext(map.boundaries, p.domain) === context);
}

/**
 * A summary the owner may copy and share with someone in one context of their life.
 * Deterministic and minimal: area, declared goal and agreed focus only, never discovery answers.
 * Areas from the other context are always left out; sensitive areas only go in with a
 * consent given for this summary (`consents`), which is not stored as a standing permission.
 */
export function buildShareSummary(
  map: LifeMap,
  proposals: Proposal[],
  feedback: Record<string, ProposalFeedback>,
  options: { audience: LifeContext; consents: LifeDomainId[]; silenced?: LifeDomainId[]; now?: string },
): ShareSummary {
  const silenced = options.silenced ?? [];
  const candidates = LIFE_DOMAINS.filter(
    (d) => proposals.some((p) => p.domain === d) || map.assessments.some((a) => a.domain === d && a.goal.trim() !== ""),
  );
  const excluded: ShareSummary["excluded"] = [];
  const included: LifeDomainId[] = [];
  for (const domain of candidates) {
    if (domainContext(map.boundaries, domain) !== options.audience) excluded.push({ domain, reason: "other_context" });
    else if (silenced.includes(domain)) excluded.push({ domain, reason: "silenced" });
    else if (map.boundaries.sensitiveDomains.includes(domain) && !options.consents.includes(domain))
      excluded.push({ domain, reason: "sensitive" });
    else included.push(domain);
  }

  const plan = planFocus(
    map,
    proposals.filter((p) => included.includes(p.domain) && p.kind !== "question"),
    feedback,
    options.now,
    silenced,
  );
  const lines = included.map((domain) => {
    const focus = plan.focus.find((p) => p.domain === domain) ?? null;
    return {
      domain,
      goal: map.assessments.find((a) => a.domain === domain)?.goal ?? "",
      focus: focus?.action ?? null,
      protected: focus !== null && focus.id === plan.protectedId,
    };
  });
  return { audience: options.audience, lines, excluded };
}
