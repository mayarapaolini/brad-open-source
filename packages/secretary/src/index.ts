import { LIFE_DOMAINS, type DomainAssessment, type LifeDomainId, type LifeMap } from "@brad/domain";
import { classifyDomain, currentAnswer, getQuestion, type Answer } from "@brad/discovery";

export type ProposalKind = "focus" | "protect" | "question";

/** What Brad offers to do. Every one is preparation for the owner; none acts outside Brad. */
export type ProposalAction =
  | "prepare_draft"
  | "show_options"
  | "organise"
  | "remind_when_asked"
  | "ask_before_acting"
  | "protect"
  | "ask_meaning"
  | "ask_support"
  | "ask_preserve";

export type Confidence = "low" | "medium" | "high";

export interface Evidence {
  type: "assessment" | "answer";
  ref: string;
  detail: Record<string, string | number | string[] | null>;
}

export interface Proposal {
  /** Stable per domain and action, so feedback sticks across recomputations. */
  id: string;
  kind: ProposalKind;
  domain: LifeDomainId;
  action: ProposalAction;
  /** The owner's goal for the domain, when declared. */
  goal: string;
  evidence: Evidence[];
  /** Sources Brad does not have and says so, instead of guessing (e.g. no calendar, no deadline). */
  missing: ("deadline" | "answers")[];
  confidence: Confidence;
  /** Always true: nothing runs without the owner. */
  requiresApproval: true;
  /** Owner asked to look at this area this week. */
  thisWeek: boolean;
}

export type FeedbackAction = "accept" | "decline" | "snooze" | "edit";

export interface ProposalFeedback {
  action: FeedbackAction;
  note: string | null;
  /** Snoozed until this instant. */
  until: string | null;
  at: string;
}

export interface Deferred {
  proposal: Proposal;
  /** The chosen item that took its place: "if you accept X, Y waits". */
  because: string;
}

export interface FocusPlan {
  /** At most three items. */
  focus: Proposal[];
  /** The protected area among the focus items, if any area goes well. */
  protectedId: string | null;
  deferred: Deferred[];
  hidden: { declined: string[]; snoozed: string[]; silenced: LifeDomainId[] };
}

export const MAX_FOCUS = 3;

/** Preferred order when the owner accepts several kinds of help. Least intrusive last. */
const SUPPORT_ORDER: ProposalAction[] = ["prepare_draft", "show_options", "organise", "ask_before_acting", "remind_when_asked"];

function answerEvidence(answer: Answer): Evidence {
  return {
    type: "answer",
    ref: answer.id,
    detail: {
      questionId: answer.questionId,
      options: answer.selectedOptionIds,
      otherText: answer.otherText,
      status: answer.status,
      asOf: answer.asOf,
    },
  };
}

function assessmentEvidence(a: DomainAssessment): Evidence {
  return {
    type: "assessment",
    ref: `assessment:${a.domain}`,
    detail: { importance: a.importance, satisfaction: a.satisfaction, asOf: a.asOf ?? null },
  };
}

function confidenceOf(basis: Answer[]): Confidence {
  if (basis.length === 0) return "low";
  return basis.every((a) => a.status === "user_confirmed" || a.status === "corrected") ? "high" : "medium";
}

function slotAnswer(answers: Answer[], domain: LifeDomainId, slot: string): Answer | undefined {
  const id = getQuestion(`${slot}.${domain}`) ? `${slot}.${domain}` : slot;
  const answer = currentAnswer(answers, domain, id);
  return answer?.outcome === "answered" ? answer : undefined;
}

/**
 * Proposals for one moment in time, derived only from the life map and the owner's own answers.
 * Deterministic. A low score chooses what to ask, never what to do: actions come from the help
 * the owner said they accept, and an area where they said "don't act" or "not now" gets nothing.
 */
export function generateProposals(map: LifeMap, answers: Answer[], silenced: LifeDomainId[] = []): Proposal[] {
  const proposals: Proposal[] = [];

  for (const a of map.assessments) {
    if (silenced.includes(a.domain)) continue;
    const path = classifyDomain(a);
    const support = slotAnswer(answers, a.domain, "support");
    if (support?.selectedOptionIds.includes("do_not_act")) continue;

    const base = (action: ProposalAction, kind: ProposalKind, basis: Answer[]): Proposal => {
      const frequency = slotAnswer(answers, a.domain, "frequency");
      return {
        id: `${a.domain}:${action}`,
        kind,
        domain: a.domain,
        action,
        goal: a.goal,
        evidence: [assessmentEvidence(a), ...basis.map(answerEvidence)],
        missing: basis.length === 0 ? ["deadline", "answers"] : ["deadline"],
        confidence: confidenceOf(basis),
        requiresApproval: true,
        thisWeek: frequency?.selectedOptionIds.includes("this_week") ?? false,
      };
    };

    if (path === "thriving") {
      const preserve = slotAnswer(answers, a.domain, "preserve");
      proposals.push(preserve ? base("protect", "protect", [preserve]) : base("ask_preserve", "question", []));
      continue;
    }

    if (path === "middle") {
      const desire = slotAnswer(answers, a.domain, "change_desire");
      if (!desire?.selectedOptionIds.includes("yes")) continue; // no wish to change: stay quiet
    }

    const meaning = slotAnswer(answers, a.domain, "meaning");
    const barrier = slotAnswer(answers, a.domain, "barrier");
    if (barrier?.selectedOptionIds.includes("not_now")) continue;
    if (!meaning) {
      proposals.push(base("ask_meaning", "question", []));
      continue;
    }
    if (!support) {
      proposals.push(base("ask_support", "question", [meaning]));
      continue;
    }
    const action = SUPPORT_ORDER.find((s) => support.selectedOptionIds.includes(s)) ?? "ask_before_acting";
    proposals.push(base(action, "focus", [meaning, ...(barrier ? [barrier] : []), support]));
  }
  return proposals;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

function importanceOf(map: LifeMap, domain: LifeDomainId): number {
  return map.assessments.find((a) => a.domain === domain)?.importance ?? 0;
}

/**
 * At most three focus items. If an important area goes well, one slot protects it (PRD RF10).
 * Focus order: areas the owner asked to see this week, then confirmed readings, then declared
 * importance, then a fixed domain order. Questions only fill slots no focus item needs.
 * Everything left out is listed with the item that took its place.
 */
export function planFocus(
  map: LifeMap,
  proposals: Proposal[],
  feedback: Record<string, ProposalFeedback> = {},
  now = new Date().toISOString(),
  silenced: LifeDomainId[] = [],
): FocusPlan {
  const declined: string[] = [];
  const snoozed: string[] = [];
  const open = proposals.filter((p) => {
    const f = feedback[p.id];
    if (f?.action === "decline") return !declined.push(p.id);
    if (f?.action === "snooze" && f.until && f.until > now) return !snoozed.push(p.id);
    return true;
  });

  const rank = (p: Proposal) => [
    p.thisWeek ? 0 : 1,
    CONFIDENCE_RANK[p.confidence],
    -importanceOf(map, p.domain),
    LIFE_DOMAINS.indexOf(p.domain),
  ];
  const compare = (x: Proposal, y: Proposal) => {
    const a = rank(x);
    const b = rank(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  };

  const protects = open.filter((p) => p.kind === "protect").sort(compare);
  const focusItems = open.filter((p) => p.kind === "focus").sort(compare);
  const questions = open.filter((p) => p.kind === "question").sort(compare);

  const protectedOne = protects[0] ?? null;
  const slots = MAX_FOCUS - (protectedOne ? 1 : 0);
  const chosen = [...focusItems, ...questions].slice(0, slots);
  const focus = protectedOne ? [...chosen, protectedOne] : chosen;

  const leftOut = [...focusItems, ...questions, ...protects].filter((p) => !focus.includes(p));
  const lastChosen = chosen.at(-1) ?? protectedOne;
  const deferred = leftOut.map((proposal) => ({
    proposal,
    because: (proposal.kind === "protect" ? protectedOne : lastChosen)?.id ?? "",
  }));

  return { focus, protectedId: protectedOne?.id ?? null, deferred, hidden: { declined, snoozed, silenced } };
}

export type Load = "lighter" | "same" | "heavier";

export interface AgencyMetrics {
  accepted: number;
  edited: number;
  declined: number;
  snoozed: number;
  /** Declining is a valid answer, not a failure: shown, never optimised away. */
  total: number;
}

export function agencyMetrics(feedback: Record<string, ProposalFeedback>): AgencyMetrics {
  const values = Object.values(feedback);
  const count = (a: FeedbackAction) => values.filter((f) => f.action === a).length;
  return { accepted: count("accept"), edited: count("edit"), declined: count("decline"), snoozed: count("snooze"), total: values.length };
}
export * from "./summary";
