import type { LifeDomainId, LifeMap } from "@brad/domain";
import { BUILTIN_CATALOG, slotAnswer, type Catalog, type Slot } from "./catalogs";
import type { Answer } from "./types";

export type SynthesisKind = "priority" | "preserve" | "barrier" | "support";
export type Verdict = "yes" | "partly" | "no";

export interface SynthesisItem {
  /** Stable per domain and kind, so feedback survives new answers. */
  id: string;
  domain: LifeDomainId;
  kind: SynthesisKind;
  questionId: string;
  optionIds: string[];
  otherText: string | null;
  freeText: string | null;
  /** Answers this item restates; nothing here is invented. */
  basis: string[];
  /** Brad's reading is an inference until the owner confirms it. */
  status: "inferred" | "user_confirmed" | "corrected" | "rejected";
}

const KIND_QUESTIONS: [SynthesisKind, Slot[]][] = [
  ["priority", ["meaning"]],
  ["preserve", ["preserve"]],
  ["barrier", ["barrier"]],
  ["support", ["support"]],
];

/**
 * "Entendi X como prioridade e Y como algo a preservar. Acertei?" — a restatement of the owner's
 * own answers, one item per domain and kind. Feedback keyed by item id sets the status.
 */
export function synthesize(
  lifeMap: LifeMap,
  answers: Answer[],
  feedback: Record<string, Verdict> = {},
  catalog: Catalog = BUILTIN_CATALOG,
): SynthesisItem[] {
  const items: SynthesisItem[] = [];
  for (const assessment of lifeMap.assessments) {
    const domain = assessment.domain;
    for (const [kind, slots] of KIND_QUESTIONS) {
      for (const slot of slots) {
        const answer = slotAnswer(catalog, answers, domain, slot);
        if (!answer) continue;
        const questionId = answer.questionId;
        if (answer.selectedOptionIds.length === 0 && !answer.otherText && !answer.freeText) continue;
        const id = `${domain}:${kind}`;
        const verdict = feedback[id];
        items.push({
          id,
          domain,
          kind,
          questionId,
          optionIds: answer.selectedOptionIds,
          otherText: answer.otherText,
          freeText: answer.freeText,
          basis: [answer.id],
          status: verdict === "yes" ? "user_confirmed" : verdict === "partly" ? "corrected" : verdict === "no" ? "rejected" : "inferred",
        });
      }
    }
  }
  return items;
}
