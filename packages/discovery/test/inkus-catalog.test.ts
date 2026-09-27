import { describe, expect, it } from "vitest";
import type { DomainAssessment } from "@brad/domain";
import {
  answerTags,
  demoInkusCatalogRecords,
  estimateQuestions,
  evalCondition,
  parseInkusCatalog,
  planDomain,
  slotAnswer,
  synthesize,
  toAnswer,
  validateAnswerInput,
  type Answer,
  type AnswerInput,
  type CatalogRecord,
} from "../src";

const { catalog, errors } = parseInkusCatalog(demoInkusCatalogRecords());
const area = (domain: DomainAssessment["domain"], importance: number, satisfaction: number): DomainAssessment => ({
  domain,
  importance,
  satisfaction,
  goal: "",
});
let seq = 0;
function answer(input: AnswerInput): Answer {
  seq += 1;
  expect(validateAnswerInput(input, catalog)).toEqual([]);
  return toAnswer(input, `a-${seq}`, `2026-09-27T10:00:${String(seq).padStart(2, "0")}Z`, catalog);
}
const ids = (plan: { sequence: { id: string }[] }) => plan.sequence.map((q) => q.id);

describe("Inkus question catalog", () => {
  it("reads active questions in order, strips the universal options and tags options by label", () => {
    expect(errors).toEqual([]);
    expect(catalog.source).toBe("inkus");
    expect(catalog.get("retired.question")).toBeUndefined();
    const help = catalog.get("help.preference")!;
    expect(help.multiple).toBe(true);
    expect(help.options.map((o) => o.id)).toEqual(["opt_1", "opt_2", "opt_3", "opt_4", "opt_5"]);
    expect(help.options.find((o) => o.id === "opt_4")!.tags).toContain("prepare_draft");
    expect(help.externalId).toMatch(/^demo-q-/);
  });

  it("reports configuration problems instead of hiding them", () => {
    const bad: CatalogRecord[] = [
      { id: "r1", fields: { question_id: "a", order: 1, options_json: '[{"id":"opt_1","label":"X"}]', branch_json: '{"next":"missing"}' } },
      { id: "r2", fields: { question_id: "a", order: 2 } },
      { id: "r3", fields: { question_id: "b", order: 3, options_json: "not json", branch_json: "{oops" } },
      { id: "r4", fields: { question_id: "c", order: 4, domain: "office" } },
    ];
    const codes = parseInkusCatalog(bad).errors.map((e) => `${e.questionId}:${e.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "a:missing_universal_option",
        "a:duplicate_id",
        "b:invalid_options",
        "b:invalid_branch",
        "c:unknown_domain",
        "a:unknown_next",
      ]),
    );
  });

  it("keeps option meanings when options are reordered, and changes the version when content changes", () => {
    const records = demoInkusCatalogRecords();
    const help = records.find((r) => r.fields.question_id === "help.preference")!;
    const reversed = JSON.stringify([
      { id: "opt_1", label: "Preparar rascunhos" },
      { id: "opt_2", label: "Não atuar" },
      { id: "other", label: "Outra resposta" },
      { id: "unknown", label: "Não sei ainda" },
      { id: "skip", label: "Prefiro não responder" },
    ]);
    const edited = parseInkusCatalog(records.map((r) => (r === help ? { ...r, fields: { ...r.fields, options_json: reversed } } : r))).catalog;
    expect(edited.get("help.preference")!.options[0]!.tags).toContain("prepare_draft");
    expect(edited.get("help.preference")!.version).not.toBe(catalog.get("help.preference")!.version);
    expect(edited.version).not.toBe(catalog.version);
  });

  it("evaluates branch conditions without eval", () => {
    const vars = { importance: 9, satisfaction: 2, domain: "finances" };
    expect(evalCondition("importance>=7 && satisfaction<=3", vars)).toBe(true);
    expect(evalCondition("domain=finances && satisfaction<=4", vars)).toBe(true);
    expect(evalCondition("domain=work", vars)).toBe(false);
    expect(evalCondition("unknown>=1", vars)).toBe(false);
    expect(evalCondition("process.exit()", vars)).toBe(false);
  });
});

describe("Inkus interview flow", () => {
  it("goes to barriers for an important area that is going badly, and asks the domain question first", () => {
    const plan = planDomain(area("finances", 10, 1), [], catalog);
    expect(ids(plan)).toEqual([
      "goal.meaning",
      "priority.protect_or_change",
      "finances.weight",
      "barrier.comb",
      "autonomy.control",
      "help.preference",
      "cadence.preference",
      "summary.confirm",
    ]);
    expect(plan.next!.id).toBe("goal.meaning");
  });

  it("skips barriers when the area is not struggling, and never repeats a question", () => {
    expect(ids(planDomain(area("social", 5, 5), [], catalog))).toEqual([
      "goal.meaning",
      "priority.protect_or_change",
      "autonomy.control",
      "help.preference",
      "cadence.preference",
      "summary.confirm",
    ]);
    // Domain trigger not met (finances satisfaction 6): no finances question.
    expect(ids(planDomain(area("finances", 8, 6), [], catalog))).not.toContain("finances.weight");
  });

  it("asks a thriving family what to protect and then how to help", () => {
    expect(ids(planDomain(area("family", 10, 8), [], catalog))).toEqual([
      "goal.meaning",
      "priority.protect_or_change",
      "family.protect",
      "help.preference",
      "cadence.preference",
      "summary.confirm",
    ]);
  });

  it("stops where the owner says 'not now' and counts progress", () => {
    const answers = [
      answer({ questionId: "goal.meaning", domain: "social", freeText: "Ver amigos" }),
      answer({ questionId: "priority.protect_or_change", domain: "social", selectedOptionIds: ["opt_5"] }),
    ];
    const plan = planDomain(area("social", 5, 5), answers, catalog);
    expect(plan).toMatchObject({ closed: true, next: null, done: 2, total: 2 });
    expect(estimateQuestions([area("social", 5, 5)], catalog)).toBe(6);
  });

  it("maps answers to Brad's slots through tags, so the secretary and synthesis work unchanged", () => {
    const answers = [
      answer({ questionId: "goal.meaning", domain: "work", freeText: "Menos reuniões" }),
      answer({ questionId: "priority.protect_or_change", domain: "work", selectedOptionIds: ["opt_1"] }),
      answer({ questionId: "help.preference", domain: "work", selectedOptionIds: ["opt_4"] }),
      answer({ questionId: "cadence.preference", domain: "work", selectedOptionIds: ["opt_1"] }),
    ];
    expect(answers[0]!.syncToInkus).toBe(true);
    expect(answerTags(catalog, answers[2]!)).toContain("prepare_draft");
    expect(slotAnswer(catalog, answers, "work", "preserve")?.questionId).toBe("priority.protect_or_change");
    expect(slotAnswer(catalog, answers, "work", "change_desire")).toBeDefined();
    expect(slotAnswer(catalog, answers, "work", "frequency")).toBeDefined();
    const map = { schemaVersion: 1 as const, owner: { displayName: "" }, people: [], assessments: [area("work", 8, 5)], boundaries: { timeZone: "UTC", quietHours: null, forbiddenCapabilities: [], sensitiveDomains: [] } };
    expect(synthesize(map, answers, {}, catalog).map((i) => i.kind)).toEqual(["priority", "preserve", "support"]);
  });

  it("rejects options that are not in the Inkus question", () => {
    expect(validateAnswerInput({ questionId: "help.preference", domain: "work", selectedOptionIds: ["prepare_draft"] }, catalog)).toContain(
      "unknown_option",
    );
    expect(validateAnswerInput({ questionId: "family.protect", domain: "work", selectedOptionIds: ["opt_1"] }, catalog)).toContain(
      "question_not_for_domain",
    );
  });
});
