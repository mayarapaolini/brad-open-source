import { LIFE_DOMAINS, type LifeDomainId } from "@brad/domain";
import { getQuestion } from "./catalog";
import type { Answer, AnswerOutcome } from "./types";

export interface AnswerInput {
  questionId: string;
  domain: LifeDomainId;
  selectedOptionIds?: string[];
  otherText?: string | null;
  freeText?: string | null;
  outcome?: AnswerOutcome;
}

const MAX_TEXT = 2000;
const OUTCOMES: AnswerOutcome[] = ["answered", "skipped", "dont_know", "prefer_not"];

/** Validates an answer against the catalog. Returns error codes; empty means valid. */
export function validateAnswerInput(input: AnswerInput): string[] {
  const errors: string[] = [];
  const question = getQuestion(input.questionId);
  if (!question) return ["unknown_question"];
  if (!(LIFE_DOMAINS as readonly string[]).includes(input.domain)) errors.push("unknown_domain");
  if (question.domain !== "any" && question.domain !== input.domain) errors.push("question_not_for_domain");
  const outcome = input.outcome ?? "answered";
  if (!OUTCOMES.includes(outcome)) errors.push("unknown_outcome");
  const selected = input.selectedOptionIds ?? [];
  if (!selected.every((id) => question.options.some((o) => o.id === id))) errors.push("unknown_option");
  if (!question.multiple && selected.length > 1) errors.push("single_choice");
  for (const text of [input.otherText, input.freeText]) {
    if (text !== undefined && text !== null && (typeof text !== "string" || text.length > MAX_TEXT)) errors.push("text_too_long");
  }
  if (outcome === "answered" && selected.length === 0 && !input.otherText?.trim() && !input.freeText?.trim()) {
    errors.push("empty_answer");
  }
  return errors;
}

export function toAnswer(input: AnswerInput, id: string, asOf: string): Answer {
  const question = getQuestion(input.questionId)!;
  const outcome = input.outcome ?? "answered";
  const answered = outcome === "answered";
  return {
    id,
    questionId: question.id,
    questionVersion: question.version,
    domain: input.domain,
    selectedOptionIds: answered ? [...new Set(input.selectedOptionIds ?? [])] : [],
    otherText: answered ? input.otherText?.trim() || null : null,
    freeText: answered ? input.freeText?.trim() || null : null,
    outcome,
    status: "self_reported",
    asOf,
    syncToInkus: false,
  };
}
