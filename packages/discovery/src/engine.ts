import type { DomainAssessment, LifeDomainId } from "@brad/domain";
import { QUESTIONS, getQuestion } from "./catalog";
import type { Answer, DomainPath, Question } from "./types";

export const IMPORTANT = 7;
export const LOW = 4;
export const HIGH = 7;

/**
 * Which conversation fits a domain. A low score picks questions; it never means urgency.
 * - struggling: it matters and it is hard → meaning, then barriers.
 * - thriving: it matters and it goes well → what to protect.
 * - middle: ask first whether there is a real wish to change.
 */
export function classifyDomain(a: Pick<DomainAssessment, "importance" | "satisfaction">): DomainPath {
  if (a.importance >= IMPORTANT && a.satisfaction <= LOW) return "struggling";
  if (a.importance >= IMPORTANT && a.satisfaction >= HIGH) return "thriving";
  return "middle";
}

/** The most specific question for a slot: a domain version wins over the generic one. */
function pick(slot: string, domain: LifeDomainId): Question {
  return getQuestion(`${slot}.${domain}`) ?? getQuestion(slot)!;
}

const PATHS: Record<DomainPath, string[]> = {
  struggling: ["meaning", "barrier", "competence", "autonomy", "relatedness", "support", "frequency"],
  thriving: ["preserve", "support", "frequency"],
  middle: ["change_desire", "meaning", "barrier", "support", "frequency"],
};

/** The latest non-stale answer to a question in a domain. */
export function currentAnswer(answers: Answer[], domain: LifeDomainId, questionId: string): Answer | undefined {
  return answers
    .filter((a) => a.domain === domain && a.questionId === questionId && a.status !== "stale")
    .sort((x, y) => x.asOf.localeCompare(y.asOf))
    .at(-1);
}

export interface DomainPlan {
  domain: LifeDomainId;
  path: DomainPath;
  /** Questions in order, follow-ups placed right after the answer that triggered them. */
  sequence: Question[];
  next: Question | null;
  done: number;
  /** Expected number of questions: the whole path plus follow-ups already triggered. */
  total: number;
  /** True when the owner closed the domain (e.g. "no wish to change now"). */
  closed: boolean;
}

/**
 * Deterministic plan for one domain given what the owner has answered so far.
 * Skipped, "don't know" and "prefer not" all count as handled: the question is not asked again.
 */
export function planDomain(assessment: DomainAssessment, answers: Answer[]): DomainPlan {
  const domain = assessment.domain;
  const path = classifyDomain(assessment);
  const sequence: Question[] = [];
  let closed = false;

  for (const slot of PATHS[path]) {
    const question = pick(slot, domain);
    sequence.push(question);
    const answer = currentAnswer(answers, domain, question.id);
    if (!answer) break;

    if (question.id === "change_desire" && !(answer.outcome === "answered" && answer.selectedOptionIds.includes("yes"))) {
      closed = true;
      break;
    }
    for (const follow of question.followUps ?? []) {
      if (answer.selectedOptionIds.includes(follow.whenOption) && !sequence.some((q) => q.id === follow.questionId)) {
        const fq = getQuestion(follow.questionId)!;
        sequence.push(fq);
        if (!currentAnswer(answers, domain, fq.id)) break;
      }
    }
    if (!currentAnswer(answers, domain, sequence.at(-1)!.id)) break;
  }

  const unanswered = sequence.find((q) => !currentAnswer(answers, domain, q.id));
  const done = sequence.filter((q) => currentAnswer(answers, domain, q.id)).length;
  const followUps = sequence.filter((q) => !PATHS[path].some((slot) => q.id === slot || q.id === `${slot}.${domain}`)).length;
  const total = closed ? done : PATHS[path].length + followUps;
  return { domain, path, sequence, next: closed ? null : (unanswered ?? null), done, total, closed };
}

/** Rough total for the "estimated time" line: every question the current answers could lead to. */
export function estimateQuestions(assessments: DomainAssessment[]): number {
  return assessments.reduce((sum, a) => sum + PATHS[classifyDomain(a)].length, 0);
}

export { QUESTIONS };
