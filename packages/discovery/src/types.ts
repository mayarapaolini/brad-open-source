import type { LifeDomainId, Localized } from "@brad/domain";

export type Construct =
  | "meaning"
  | "change_desire"
  | "preserve"
  | "autonomy"
  | "competence"
  | "relatedness"
  | "barrier"
  | "support"
  | "frequency"
  | "evidence";

export interface QuestionOption {
  id: string;
  label: Localized;
}

export interface Question {
  /** Stable id plus version: a wording change creates a new version, old answers keep theirs. */
  id: string;
  version: number;
  /** "any" questions are asked per domain; a specific domain overrides the generic one. */
  domain: LifeDomainId | "any";
  construct: Construct;
  text: Localized;
  options: QuestionOption[];
  multiple: boolean;
  /** Follow-up asked when one of these options is selected. */
  followUps?: { whenOption: string; questionId: string }[];
  /** Methodological inspiration. Authored questions, not a validated instrument. */
  source: string;
  purpose: Localized;
}

/**
 * Every question also accepts these, whatever its options (PRD, universal response rule):
 * "Outra resposta" with text, free text on its own, don't know, prefer not to answer, skip.
 */
export type AnswerOutcome = "answered" | "skipped" | "dont_know" | "prefer_not";

export type AnswerStatus = "self_reported" | "user_confirmed" | "corrected" | "inferred" | "stale";

export interface Answer {
  id: string;
  questionId: string;
  questionVersion: number;
  domain: LifeDomainId;
  selectedOptionIds: string[];
  /** Text for "Outra resposta". */
  otherText: string | null;
  /** Free text, allowed with or without options. */
  freeText: string | null;
  outcome: AnswerOutcome;
  status: AnswerStatus;
  asOf: string;
  /** Per-item consent to sync with Inkus. Off unless the owner turns it on. */
  syncToInkus: boolean;
}

export type DomainPath = "struggling" | "thriving" | "middle";
