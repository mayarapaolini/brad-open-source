import { describe, expect, it } from "vitest";
import { demoLifeMap, type DomainAssessment } from "@brad/domain";
import {
  QUESTIONS,
  classifyDomain,
  planDomain,
  synthesize,
  toAnswer,
  validateAnswerInput,
  type Answer,
  type AnswerInput,
} from "../src";

let seq = 0;
function answer(input: AnswerInput, asOf = `2026-09-26T12:00:${String(seq).padStart(2, "0")}Z`): Answer {
  seq += 1;
  expect(validateAnswerInput(input)).toEqual([]);
  return toAnswer(input, `a-${seq}`, asOf);
}

const finances: DomainAssessment = { domain: "finances", satisfaction: 1, importance: 10, goal: "No debt" };
const family: DomainAssessment = { domain: "family", satisfaction: 8, importance: 10, goal: "Daily time together" };
const social: DomainAssessment = { domain: "social", satisfaction: 5, importance: 5, goal: "" };

describe("classifyDomain (RF03)", () => {
  it("separates struggling, thriving and middle domains", () => {
    expect(classifyDomain(finances)).toBe("struggling");
    expect(classifyDomain(family)).toBe("thriving");
    expect(classifyDomain(social)).toBe("middle");
  });
});

describe("planDomain", () => {
  it("asks about meaning and then barriers when a domain matters and is hard, using the domain's own barrier question", () => {
    expect(planDomain(finances, [])).toMatchObject({ next: { id: "meaning" }, done: 0, total: 7 });
    const a1 = answer({ questionId: "meaning", domain: "finances", selectedOptionIds: ["preserve"] });
    expect(planDomain(finances, [a1]).next?.id).toBe("barrier.finances");
  });

  it("follows up on a selected option (taxes → what kind of help)", () => {
    const a1 = answer({ questionId: "meaning", domain: "finances", selectedOptionIds: ["preserve"] });
    const a2 = answer({ questionId: "barrier.finances", domain: "finances", selectedOptionIds: ["taxes"] });
    expect(planDomain(finances, [a1, a2]).next?.id).toBe("finances.taxes_help");
    const a3 = answer({ questionId: "finances.taxes_help", domain: "finances", selectedOptionIds: ["organise_deadlines"] });
    expect(planDomain(finances, [a1, a2, a3]).next?.id).toBe("competence");
  });

  it("asks what to protect when a domain matters and goes well", () => {
    expect(planDomain(family, []).next?.id).toBe("preserve.family");
    expect(planDomain(family, []).path).toBe("thriving");
  });

  it("asks whether there is a real wish to change before anything else in middle domains, and stops on 'no'", () => {
    expect(planDomain(social, []).next?.id).toBe("change_desire");
    const no = answer({ questionId: "change_desire", domain: "social", selectedOptionIds: ["not_now"] });
    expect(planDomain(social, [no])).toMatchObject({ next: null, closed: true });
    const yes = answer({ questionId: "change_desire", domain: "social", selectedOptionIds: ["yes"] });
    expect(planDomain(social, [yes]).next?.id).toBe("meaning");
  });

  it("never asks a skipped, 'don't know' or 'prefer not' question again (RF05)", () => {
    const skip = answer({ questionId: "meaning", domain: "finances", outcome: "skipped" });
    expect(planDomain(finances, [skip]).next?.id).toBe("barrier.finances");
    const prefer = answer({ questionId: "barrier.finances", domain: "finances", outcome: "prefer_not" });
    expect(planDomain(finances, [skip, prefer]).next?.id).toBe("competence");
  });

  it("uses the latest non-stale answer when an answer is edited (RF05)", () => {
    const first = answer({ questionId: "barrier.finances", domain: "finances", selectedOptionIds: ["debt"] }, "2026-09-26T10:00:00Z");
    const edited = answer({ questionId: "barrier.finances", domain: "finances", selectedOptionIds: ["taxes"] }, "2026-09-26T11:00:00Z");
    const meaning = answer({ questionId: "meaning", domain: "finances", selectedOptionIds: ["preserve"] });
    expect(planDomain(finances, [meaning, { ...first, status: "stale" }, edited]).next?.id).toBe("finances.taxes_help");
  });
});

describe("universal response rule (RF04)", () => {
  it("accepts 'Outra resposta' text or free text alone on every question, including follow-ups", () => {
    for (const q of QUESTIONS) {
      const domain = q.domain === "any" ? "work" : q.domain;
      expect(validateAnswerInput({ questionId: q.id, domain, otherText: "Something else" })).toEqual([]);
      expect(validateAnswerInput({ questionId: q.id, domain, freeText: "In my own words" })).toEqual([]);
      expect(validateAnswerInput({ questionId: q.id, domain, outcome: "dont_know" })).toEqual([]);
      expect(validateAnswerInput({ questionId: q.id, domain, outcome: "prefer_not" })).toEqual([]);
    }
  });

  it("has PT and EN text, a source and a purpose for every question and option", () => {
    for (const q of QUESTIONS) {
      expect(q.text.pt && q.text.en && q.source && q.purpose.pt && q.purpose.en).toBeTruthy();
      for (const o of q.options) expect(o.label.pt && o.label.en).toBeTruthy();
    }
  });

  it("rejects empty answers, unknown options and too many choices", () => {
    expect(validateAnswerInput({ questionId: "meaning", domain: "work" })).toEqual(["empty_answer"]);
    expect(validateAnswerInput({ questionId: "meaning", domain: "work", selectedOptionIds: ["nope"] })).toEqual(["unknown_option"]);
    expect(validateAnswerInput({ questionId: "autonomy", domain: "work", selectedOptionIds: ["decide", "partly"] })).toEqual([
      "single_choice",
    ]);
    expect(validateAnswerInput({ questionId: "barrier.finances", domain: "work", otherText: "x" })).toEqual([
      "question_not_for_domain",
    ]);
  });
});

describe("synthesize", () => {
  it("restates the owner's answers as items to confirm, and applies feedback", () => {
    const meaning = answer({ questionId: "meaning", domain: "finances", selectedOptionIds: ["reduce_weight"] });
    const barrier = answer({ questionId: "barrier.finances", domain: "finances", selectedOptionIds: [], otherText: "Irregular income" });
    const preserve = answer({ questionId: "preserve.family", domain: "family", selectedOptionIds: ["meal"] });
    const items = synthesize(demoLifeMap, [meaning, barrier, preserve], { "family:preserve": "yes" });
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ["family:preserve", "user_confirmed"],
      ["finances:priority", "inferred"],
      ["finances:barrier", "inferred"],
    ]);
    expect(items.find((i) => i.id === "finances:barrier")).toMatchObject({ otherText: "Irregular income", basis: [barrier.id] });
  });

  it("does not turn skipped questions into claims", () => {
    const skip = answer({ questionId: "meaning", domain: "finances", outcome: "skipped" });
    expect(synthesize(demoLifeMap, [skip])).toEqual([]);
  });
});
