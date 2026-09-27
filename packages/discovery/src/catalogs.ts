import { LIFE_DOMAINS, type DomainAssessment, type LifeDomainId } from "@brad/domain";
import { QUESTIONS, getQuestion } from "./catalog";
import { classifyDomain, currentAnswer, planBuiltin, type DomainPlan } from "./engine";
import type { Answer, Branch, Question } from "./types";

/** The meanings Brad's rules read from answers, whatever the catalog calls its questions. */
export type Slot =
  | "meaning"
  | "change_desire"
  | "preserve"
  | "barrier"
  | "support"
  | "frequency"
  | "autonomy"
  | "competence"
  | "relatedness"
  | "confirmation";

export interface SlotCandidate {
  questionId: string;
  /** The answer only counts for the slot when one of its options carries this tag. */
  requireTag?: string;
}

/** A question catalog: Brad's built-in one, or one read from Inkus. */
export interface Catalog {
  source: "builtin" | "inkus";
  /** Identity of the catalog content, so a change is visible. */
  version: string;
  questions: Question[];
  get(id: string): Question | undefined;
  /** Questions that answer a slot in a domain, most specific first. */
  slot(domain: LifeDomainId, slot: Slot): SlotCandidate[];
  plan(assessment: DomainAssessment, answers: Answer[]): DomainPlan;
}

export const BUILTIN_CATALOG: Catalog = {
  source: "builtin",
  version: "builtin-1",
  questions: QUESTIONS,
  get: getQuestion,
  // A domain version of a question replaces the generic one.
  slot: (domain, slot) => [{ questionId: getQuestion(`${slot}.${domain}`) ? `${slot}.${domain}` : slot }],
  plan: planBuiltin,
};

/** What the chosen options mean. Options without tags mean their own id. */
export function answerTags(catalog: Catalog, answer: Answer): string[] {
  const question = catalog.get(answer.questionId);
  return answer.selectedOptionIds.flatMap((id) => question?.options.find((o) => o.id === id)?.tags ?? [id]);
}

/** The owner's current, answered reply for a slot in a domain, if any. */
export function slotAnswer(catalog: Catalog, answers: Answer[], domain: LifeDomainId, slot: Slot): Answer | undefined {
  for (const candidate of catalog.slot(domain, slot)) {
    const answer = currentAnswer(answers, domain, candidate.questionId);
    if (answer?.outcome !== "answered") continue;
    if (candidate.requireTag && !answerTags(catalog, answer).includes(candidate.requireTag)) continue;
    return answer;
  }
  return undefined;
}

export function planDomain(assessment: DomainAssessment, answers: Answer[], catalog: Catalog = BUILTIN_CATALOG): DomainPlan {
  return catalog.plan(assessment, answers);
}

/** Rough total for the "estimated time" line: every question the current scores lead to. */
export function estimateQuestions(assessments: DomainAssessment[], catalog: Catalog = BUILTIN_CATALOG): number {
  return assessments.reduce((sum, a) => sum + catalog.plan(a, []).total, 0);
}

// ---------------------------------------------------------------------------------------------
// Inkus catalog: records of the "Perguntas para configurar agentes" database.
// ---------------------------------------------------------------------------------------------

/** A database record as Inkus returns it (only the fields Brad reads). */
export interface CatalogRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface CatalogError {
  questionId: string | null;
  code:
    | "missing_id"
    | "duplicate_id"
    | "invalid_options"
    | "invalid_branch"
    | "unknown_domain"
    | "missing_universal_option"
    | "unknown_next";
  detail?: string;
}

/** Options every question must offer; Brad renders them as its own universal controls. */
const UNIVERSAL = ["other", "unknown", "skip"];

/** Domain questions are inserted right after this one when their trigger applies (workflow contract). */
const INSERT_AFTER = "priority.protect_or_change";

const INKUS_SLOTS: Record<Slot, SlotCandidate[]> = {
  meaning: [{ questionId: "goal.meaning" }],
  change_desire: [{ questionId: "priority.protect_or_change" }],
  preserve: [{ questionId: "family.protect" }, { questionId: "priority.protect_or_change", requireTag: "protect" }],
  barrier: [{ questionId: "barrier.comb" }],
  support: [{ questionId: "help.preference" }],
  frequency: [{ questionId: "cadence.preference" }],
  autonomy: [{ questionId: "autonomy.control" }],
  competence: [{ questionId: "capacity.energy" }],
  relatedness: [{ questionId: "relatedness.support" }],
  confirmation: [{ questionId: "summary.confirm" }],
};

export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Option meaning by label, so reordering options in Inkus never changes what an answer means. */
const LABEL_TAGS: Record<string, string[]> = {
  "preservar como esta": ["preserve"],
  "reduzir um peso": ["reduce_weight"],
  "ganhar tempo": ["gain_time"],
  "melhorar a qualidade": ["improve_quality"],
  reconstruir: ["rebuild"],
  "proteger o que ja funciona": ["protect", "yes"],
  "resolver algo urgente": ["yes"],
  "fazer um pequeno ajuste": ["yes"],
  "so entender melhor": ["yes"],
  "nao quero mexer nisso agora": ["no", "not_now"],
  "nao quero agir agora": ["not_now"],
  "so quando eu pedir": ["remind_when_asked"],
  "organizar informacoes": ["organise"],
  "mostrar opcoes": ["show_options"],
  "preparar rascunhos": ["prepare_draft"],
  "lembrar em momentos definidos": ["remind_when_asked"],
  "propor um proximo passo": ["show_options"],
  "nao atuar": ["do_not_act"],
  "esta semana": ["this_week"],
  "esta certo": ["confirmed"],
  "esta certo em parte": ["partly"],
  "precisa mudar": ["needs_change"],
  "prefiro deixar em rascunho": ["keep_draft"],
};

/** Fallback when a label is not recognised: the meaning of each position in the first catalog. */
const POSITION_TAGS: Record<string, string[][]> = {
  "priority.protect_or_change": [["protect", "yes"], ["yes"], ["yes"], ["yes"], ["no", "not_now"]],
  "barrier.comb": [[], [], [], [], [], [], ["not_now"]],
  "help.preference": [
    ["remind_when_asked"],
    ["organise"],
    ["show_options"],
    ["prepare_draft"],
    ["remind_when_asked"],
    ["show_options"],
    ["do_not_act"],
  ],
  "cadence.preference": [["this_week"]],
};

/** Small FNV-1a hash: runs in the browser and in Node, enough to notice a changed question. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function parseBranch(raw: unknown): Branch | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (value.end === true) return { kind: "end" };
  if (typeof value.if === "string" && typeof value.next === "string" && typeof value.else === "string")
    return { kind: "if", condition: value.if, next: value.next, otherwise: value.else };
  if (typeof value.trigger === "string" && typeof value.then === "string")
    return { kind: "trigger", condition: value.trigger, then: value.then };
  if (typeof value.next === "string") return { kind: "next", next: value.next };
  return null;
}

type Vars = Record<string, string | number>;

/**
 * Evaluates a branch condition such as `importance>=7 && satisfaction<=3` or `domain=finances`.
 * A tiny parser, never `eval`: only `&&`, comparisons and known variables. Unknown means false.
 */
export function evalCondition(condition: string, vars: Vars): boolean {
  return condition.split("&&").every((part) => {
    const m = /^\s*(\w+)\s*(>=|<=|==|!=|=|>|<)\s*([\w.-]+)\s*$/.exec(part);
    if (!m) return false;
    const [, name, op, raw] = m as unknown as [string, string, string, string];
    const left = vars[name!];
    if (left === undefined) return false;
    const right = typeof left === "number" ? Number(raw) : raw;
    if (typeof left === "number" && Number.isNaN(right)) return false;
    switch (op) {
      case ">=":
        return left >= right;
      case "<=":
        return left <= right;
      case ">":
        return left > right;
      case "<":
        return left < right;
      case "!=":
        return left !== right;
      default:
        return left === right;
    }
  });
}

/**
 * Turns Inkus records into a catalog. Only active questions, ordered by `order`. Problems are
 * reported, never hidden: a question missing "other", "unknown" or "skip" still gets them from
 * Brad (its universal controls), and the gap is listed as a configuration error.
 */
export function parseInkusCatalog(records: CatalogRecord[]): { catalog: Catalog; errors: CatalogError[] } {
  const errors: CatalogError[] = [];
  const seen = new Set<string>();
  const questions: Question[] = [];
  const active = records
    .filter((r) => (r.fields.status ?? "active") === "active")
    .sort((a, b) => Number(a.fields.order ?? 0) - Number(b.fields.order ?? 0));

  for (const record of active) {
    const f = record.fields;
    const id = typeof f.question_id === "string" ? f.question_id.trim() : "";
    if (!id) {
      errors.push({ questionId: null, code: "missing_id", detail: record.id });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ questionId: id, code: "duplicate_id" });
      continue;
    }
    seen.add(id);

    const domainRaw = String(f.domain ?? "all");
    const domain = domainRaw === "all" ? "any" : (domainRaw as LifeDomainId);
    if (domain !== "any" && !LIFE_DOMAINS.includes(domain)) {
      errors.push({ questionId: id, code: "unknown_domain", detail: domainRaw });
      continue;
    }

    let rawOptions: { id?: unknown; label?: unknown }[] = [];
    try {
      const parsed = JSON.parse(String(f.options_json ?? "[]")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("not a list");
      rawOptions = parsed as { id?: unknown; label?: unknown }[];
    } catch {
      errors.push({ questionId: id, code: "invalid_options" });
    }
    const ids = rawOptions.map((o) => String(o.id ?? ""));
    for (const u of UNIVERSAL) if (!ids.includes(u)) errors.push({ questionId: id, code: "missing_universal_option", detail: u });
    const own = rawOptions.filter((o) => typeof o.id === "string" && typeof o.label === "string" && !UNIVERSAL.includes(o.id));
    const options = own.map((o, index) => {
      const label = String(o.label);
      const tags = LABEL_TAGS[normalizeLabel(label)] ?? POSITION_TAGS[id]?.[index] ?? [];
      return { id: String(o.id), label: { pt: label, en: label }, tags: [String(o.id), ...tags] };
    });

    const branch = parseBranch(f.branch_json);
    if (f.branch_json !== undefined && f.branch_json !== null && f.branch_json !== "" && !branch)
      errors.push({ questionId: id, code: "invalid_branch" });

    const prompt = String(f.prompt_pt_br ?? "");
    questions.push({
      id,
      version: hash(`${prompt}|${String(f.options_json ?? "")}|${String(f.branch_json ?? "")}`),
      domain,
      construct: String(f.construct ?? ""),
      // Inkus questions are written in Portuguese; the English interface shows them as they are.
      text: { pt: prompt, en: prompt },
      options,
      multiple: String(f.answer_type ?? "").startsWith("multi"),
      source: String(f.source ?? ""),
      purpose: { pt: "", en: "" },
      stage: String(f.stage ?? ""),
      branch: branch ?? undefined,
      externalId: record.id,
    });
  }

  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const q of questions) {
    const targets =
      q.branch?.kind === "next"
        ? [q.branch.next]
        : q.branch?.kind === "if"
          ? [q.branch.next, q.branch.otherwise]
          : q.branch?.kind === "trigger"
            ? [q.branch.then]
            : [];
    for (const t of targets) if (!byId.has(t)) errors.push({ questionId: q.id, code: "unknown_next", detail: t });
  }

  const version = hash(questions.map((q) => `${q.id}:${q.version}`).join(","));
  const catalog: Catalog = {
    source: "inkus",
    version,
    questions,
    get: (id) => byId.get(id),
    slot: (domain, slot) =>
      INKUS_SLOTS[slot].filter((c) => {
        const q = byId.get(c.questionId);
        return q !== undefined && (q.domain === "any" || q.domain === domain);
      }),
    plan: (assessment, answers) => planInkus(questions, byId, assessment, answers),
  };
  return { catalog, errors };
}

/**
 * Follows the Inkus interview for one domain: start after the scores (the diagnostic already
 * asked them), follow `branch_json`, insert the domain's own question after INSERT_AFTER when its
 * trigger applies, never repeat a question, and stop where the owner said "not now".
 */
function planInkus(
  questions: Question[],
  byId: Map<string, Question>,
  assessment: DomainAssessment,
  answers: Answer[],
): DomainPlan {
  const domain = assessment.domain;
  const vars: Vars = { importance: assessment.importance, satisfaction: assessment.satisfaction, domain };
  const start = questions.find((q) => q.stage !== "initial" && q.domain === "any");
  const domainQuestions = questions.filter(
    (q) => q.domain === domain && (q.branch?.kind !== "trigger" || evalCondition(q.branch.condition, vars)),
  );

  const nextOf = (q: Question): string | null => {
    switch (q.branch?.kind) {
      case "next":
        return q.branch.next;
      case "if":
        return evalCondition(q.branch.condition, vars) ? q.branch.next : q.branch.otherwise;
      case "trigger":
        return q.branch.then;
      default:
        return null;
    }
  };

  const sequence: Question[] = [];
  const visited = new Set<string>();
  let closed = false;
  let current: Question | undefined = start;
  while (current && sequence.length < 50) {
    visited.add(current.id);
    sequence.push(current);
    const answer = currentAnswer(answers, domain, current.id);
    if (answer?.outcome === "answered" && answer.selectedOptionIds.some((id) => current!.options.find((o) => o.id === id)?.tags?.includes("no"))) {
      closed = true;
      break;
    }
    const inserted: Question | undefined =
      current.id === INSERT_AFTER ? domainQuestions.find((q) => !visited.has(q.id)) : undefined;
    let nextId = inserted ? inserted.id : nextOf(current);
    // Never repeat a question (e.g. barrier.comb reached twice): continue from where it leads.
    for (let hops = 0; nextId && visited.has(nextId) && hops < 50; hops++) nextId = nextOf(byId.get(nextId)!);
    current = nextId ? byId.get(nextId) : undefined;
  }

  const done = sequence.filter((q) => currentAnswer(answers, domain, q.id)).length;
  const next = closed ? null : (sequence.find((q) => !currentAnswer(answers, domain, q.id)) ?? null);
  return { domain, path: classifyDomain(assessment), sequence, next, done, total: closed ? done : sequence.length, closed };
}
