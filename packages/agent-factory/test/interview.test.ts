import { describe, expect, it } from "vitest";
import { demoLifeMap } from "@brad/domain";
import { demoInkusCatalogRecords, parseInkusCatalog, toAnswer, type Answer, type AnswerInput } from "@brad/discovery";
import { generateDraftAgents, proposeFromInterview } from "../src";

const { catalog } = parseInkusCatalog(demoInkusCatalogRecords());
const agents = generateDraftAgents(demoLifeMap);
const health = agents.find((a) => a.domain === "health")!;
let n = 0;
const answer = (input: AnswerInput, status: Answer["status"] = "self_reported"): Answer => {
  n += 1;
  return { ...toAnswer(input, `a${n}`, `2026-09-27T10:00:${String(n).padStart(2, "0")}Z`, catalog), status };
};

describe("proposeFromInterview", () => {
  it("proposes nothing without answers about meaning or help", () => {
    expect(proposeFromInterview(health, demoLifeMap, [], catalog)).toBeNull();
  });

  it("uses the owner's own words as the goal and the help they asked for as responsibilities", () => {
    const answers = [
      answer({ questionId: "goal.meaning", domain: "health", freeText: "Dormir antes da meia-noite" }),
      answer({ questionId: "barrier.comb", domain: "health", selectedOptionIds: ["opt_1"] }),
      answer({ questionId: "help.preference", domain: "health", selectedOptionIds: ["opt_2", "opt_4"] }),
      answer({ questionId: "cadence.preference", domain: "health", selectedOptionIds: ["opt_1"] }),
    ];
    const p = proposeFromInterview(health, demoLifeMap, answers, catalog, "pt")!;
    expect(p.proposed.goal).toBe("Dormir antes da meia-noite");
    expect(p.proposed.responsibilities).toEqual([
      "Preparar rascunhos para sua revisão; nunca enviar",
      "Organizar as informações desta área",
      "Levar em conta: Falta de tempo",
      "Rever com você: Esta semana",
    ]);
    expect(p.proposed.requestedCapabilities).toEqual(expect.arrayContaining(["draft_reply", "read_notes"]));
    expect(p.basis).toHaveLength(4);
    expect(p.ownerWords).toContain("Dormir antes da meia-noite");
    expect(p).toMatchObject({ changed: true, confirmed: false, warnings: [] });
  });

  it("only requests capabilities, never beyond the owner's boundaries", () => {
    const map = { ...demoLifeMap, boundaries: { ...demoLifeMap.boundaries, forbiddenCapabilities: ["draft_reply" as const] } };
    const p = proposeFromInterview(health, map, [answer({ questionId: "help.preference", domain: "health", selectedOptionIds: ["opt_4"] })], catalog)!;
    expect(p.proposed.requestedCapabilities).not.toContain("draft_reply");
    expect(p.excludedByBoundary).toEqual(["draft_reply"]);
  });

  it("turns 'Não atuar' into an agent that does nothing, and flags a summary the owner wants changed", () => {
    const answers = [
      answer({ questionId: "help.preference", domain: "health", selectedOptionIds: ["opt_5"] }, "user_confirmed"),
      answer({ questionId: "summary.confirm", domain: "health", selectedOptionIds: ["opt_2"] }, "user_confirmed"),
    ];
    const p = proposeFromInterview(health, demoLifeMap, answers, catalog, "en")!;
    expect(p.proposed).toMatchObject({ responsibilities: ["Do not act in this area"], requestedCapabilities: [] });
    expect(p.warnings).toEqual(["summary_needs_change", "do_not_act"]);
    expect(p.confirmed).toBe(true);
  });

  it("works with the built-in catalog too, and ignores cross-cutting agents", () => {
    const builtin = [toAnswer({ questionId: "support", domain: "family", selectedOptionIds: ["prepare_draft"] }, "b1", "2026-09-27T10:00:00Z")];
    const family = agents.find((a) => a.domain === "family")!;
    expect(proposeFromInterview(family, demoLifeMap, builtin)!.proposed.responsibilities).toEqual([
      "Preparar rascunhos para sua revisão; nunca enviar",
    ]);
    expect(proposeFromInterview({ ...family, domain: null }, demoLifeMap, builtin)).toBeNull();
  });
});
