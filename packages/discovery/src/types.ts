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
  /**
   * What choosing this option means to Brad (e.g. "prepare_draft", "not_now", "yes").
   * Built-in options mean their own id; options read from Inkus keep their ids (opt_1…) and
   * get tags from their label, so the rules never depend on option order.
   */
  tags?: string[];
}

/** Where to go after a question, as written in the Inkus catalog's `branch_json`. */
export type Branch =
  | { kind: "next"; next: string }
  | { kind: "if"; condition: string; next: string; otherwise: string }
  | { kind: "trigger"; condition: string; then: string }
  | { kind: "end" };

export interface Question {
  /** Stable id plus version: a wording change creates a new version, old answers keep theirs. */
  id: string;
  /** A number for built-in questions; a content hash for questions read from Inkus. */
  version: number | string;
  /** "any" questions are asked per domain; a specific domain overrides the generic one. */
  domain: LifeDomainId | "any";
  construct: Construct | string;
  text: Localized;
  options: QuestionOption[];
  multiple: boolean;
  /** Follow-up asked when one of these options is selected. */
  followUps?: { whenOption: string; questionId: string }[];
  /** Methodological inspiration. Authored questions, not a validated instrument. */
  source: string;
  purpose: Localized;
  /** Inkus catalog only: interview stage, branching rule and the record the question came from. */
  stage?: string;
  branch?: Branch;
  externalId?: string;
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
  questionVersion: number | string;
  domain: LifeDomainId;
  selectedOptionIds: string[];
  /** Text for "Outra resposta". */
  otherText: string | null;
  /** Free text, allowed with or without options. */
  freeText: string | null;
  outcome: AnswerOutcome;
  status: AnswerStatus;
  asOf: string;
  /** Per-item consent to sync with Inkus. Off unless the owner turns it on (built-in catalog). */
  syncToInkus: boolean;
  /** The Inkus record this answer is stored in, and the status last written there. */
  inkus?: { recordId: string; pushedStatus: AnswerStatus };
}

export type DomainPath = "struggling" | "thriving" | "middle";
