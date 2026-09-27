import { describe, expect, it } from "vitest";
import { demoLifeMap } from "@brad/domain";
import { toAnswer, type Answer, type AnswerInput } from "@brad/discovery";
import { MAX_FOCUS, agencyMetrics, buildShareSummary, generateProposals, inContext, planFocus } from "../src";

let n = 0;
const ans = (input: AnswerInput, status: Answer["status"] = "self_reported"): Answer => {
  n += 1;
  return { ...toAnswer(input, `a${n}`, `2026-09-26T10:00:${String(n).padStart(2, "0")}Z`), status };
};
const NOW = "2026-09-26T12:00:00Z";

// Demo: work 7/8 (thriving), health 4/9 (struggling), family 5/10, finances 6/7 (middle).
const answered = [
  ans({ questionId: "preserve", domain: "work", selectedOptionIds: ["time"] }),
  ans({ questionId: "meaning", domain: "health", selectedOptionIds: ["reduce_weight"] }),
  ans({ questionId: "support", domain: "health", selectedOptionIds: ["show_options", "remind_when_asked"] }),
  ans({ questionId: "change_desire", domain: "finances", selectedOptionIds: ["yes"] }),
  ans({ questionId: "meaning", domain: "finances", selectedOptionIds: ["reduce_weight"] }),
  ans({ questionId: "support", domain: "finances", selectedOptionIds: ["organise"] }),
  ans({ questionId: "change_desire", domain: "family", selectedOptionIds: ["yes"] }),
  ans({ questionId: "meaning", domain: "family", otherText: "Dinner together" }),
  ans({ questionId: "support", domain: "family", selectedOptionIds: ["prepare_draft"] }),
  ans({ questionId: "frequency", domain: "family", selectedOptionIds: ["this_week"] }),
];

describe("generateProposals", () => {
  it("asks before proposing anything when there are no answers, and stays quiet in middling areas", () => {
    const proposals = generateProposals(demoLifeMap, []);
    expect(proposals.map((p) => p.id)).toEqual(["work:ask_preserve", "health:ask_meaning"]);
    expect(proposals.every((p) => p.kind === "question" && p.confidence === "low" && p.requiresApproval)).toBe(true);
    expect(proposals[0]!.missing).toEqual(["deadline", "answers"]);
  });

  it("turns the help the owner accepts into proposals, with evidence and missing sources", () => {
    const proposals = generateProposals(demoLifeMap, answered);
    expect(proposals.map((p) => [p.id, p.kind])).toEqual([
      ["family:prepare_draft", "focus"],
      ["work:protect", "protect"],
      ["health:show_options", "focus"],
      ["finances:organise", "focus"],
    ]);
    const health = proposals.find((p) => p.id === "health:show_options")!;
    expect(health.evidence.map((e) => e.type)).toEqual(["assessment", "answer", "answer"]);
    expect(health.evidence[0]!.detail).toMatchObject({ importance: 9, satisfaction: 4 });
    expect(health.missing).toEqual(["deadline"]);
    expect(health.confidence).toBe("medium");
  });

  it("respects 'do not act', 'not now' and silenced areas", () => {
    const extra = [
      ans({ questionId: "barrier", domain: "health", selectedOptionIds: ["not_now"] }),
      ans({ questionId: "support", domain: "finances", selectedOptionIds: ["do_not_act"] }),
    ];
    const ids = generateProposals(demoLifeMap, [...answered, ...extra], ["family"]).map((p) => p.id);
    expect(ids).toEqual(["work:protect"]);
  });

  it("raises confidence only when the owner confirmed the basis", () => {
    const confirmed = answered.map((a) => (a.domain === "health" ? { ...a, status: "user_confirmed" as const } : a));
    expect(generateProposals(demoLifeMap, confirmed).find((p) => p.domain === "health")?.confidence).toBe("high");
  });
});

describe("planFocus (RF10)", () => {
  it("keeps at most three items, protects an area that goes well and explains what waits", () => {
    const plan = planFocus(demoLifeMap, generateProposals(demoLifeMap, answered), {}, NOW);
    expect(plan.focus).toHaveLength(MAX_FOCUS);
    expect(plan.focus.map((p) => p.id)).toEqual(["family:prepare_draft", "health:show_options", "work:protect"]);
    expect(plan.protectedId).toBe("work:protect");
    expect(plan.deferred).toEqual([{ proposal: expect.objectContaining({ id: "finances:organise" }), because: "health:show_options" }]);
  });

  it("hides declined and snoozed proposals until the snooze ends, and counts them without judging", () => {
    const proposals = generateProposals(demoLifeMap, answered);
    const feedback = {
      "family:prepare_draft": { action: "decline" as const, note: null, until: null, at: NOW },
      "health:show_options": { action: "snooze" as const, note: null, until: "2026-10-03T12:00:00Z", at: NOW },
    };
    const plan = planFocus(demoLifeMap, proposals, feedback, NOW);
    expect(plan.focus.map((p) => p.id)).toEqual(["finances:organise", "work:protect"]);
    expect(plan.hidden).toMatchObject({ declined: ["family:prepare_draft"], snoozed: ["health:show_options"] });
    expect(planFocus(demoLifeMap, proposals, feedback, "2026-10-04T00:00:00Z").focus.map((p) => p.id)).toContain(
      "health:show_options",
    );
    expect(agencyMetrics(feedback)).toEqual({ accepted: 0, edited: 0, declined: 1, snoozed: 1, total: 2 });
  });

  it("is deterministic", () => {
    const a = planFocus(demoLifeMap, generateProposals(demoLifeMap, answered), {}, NOW);
    const b = planFocus(demoLifeMap, generateProposals(demoLifeMap, [...answered].reverse()), {}, NOW);
    expect(b.focus.map((p) => p.id)).toEqual(a.focus.map((p) => p.id));
  });
});

describe("contexts and the summary to share", () => {
  const proposals = generateProposals(demoLifeMap, answered);

  it("filters proposals to one context", () => {
    expect(inContext(demoLifeMap, proposals, "work").map((p) => p.id)).toEqual(["work:protect"]);
    expect(inContext(demoLifeMap, proposals, "personal").map((p) => p.domain)).not.toContain("work");
  });

  it("never lets personal areas into a work summary, whatever the consents", () => {
    const summary = buildShareSummary(demoLifeMap, proposals, {}, { audience: "work", consents: ["health", "family"], now: NOW });
    expect(summary.lines.map((l) => l.domain)).toEqual(["work", "study"]);
    expect(summary.lines[0]).toMatchObject({ focus: "protect", protected: true });
    expect(summary.excluded).toContainEqual({ domain: "health", reason: "other_context" });
    expect(summary.excluded).toContainEqual({ domain: "family", reason: "other_context" });
  });

  it("leaves health and finances out of a personal summary until the owner consents for this one", () => {
    const without = buildShareSummary(demoLifeMap, proposals, {}, { audience: "personal", consents: [], now: NOW });
    expect(without.lines.map((l) => l.domain)).not.toContain("health");
    expect(without.excluded).toContainEqual({ domain: "health", reason: "sensitive" });
    expect(without.excluded).toContainEqual({ domain: "finances", reason: "sensitive" });
    const withHealth = buildShareSummary(demoLifeMap, proposals, {}, { audience: "personal", consents: ["health"], now: NOW });
    expect(withHealth.lines.find((l) => l.domain === "health")).toMatchObject({ focus: "show_options" });
    expect(withHealth.excluded).not.toContainEqual({ domain: "health", reason: "sensitive" });
  });

  it("carries goals and focus only, never the owner's answers, and is deterministic", () => {
    const a = buildShareSummary(demoLifeMap, proposals, {}, { audience: "personal", consents: ["health"], now: NOW });
    expect(JSON.stringify(a)).not.toContain("Dinner together");
    expect(buildShareSummary(demoLifeMap, proposals, {}, { audience: "personal", consents: ["health"], now: NOW })).toEqual(a);
  });
});

