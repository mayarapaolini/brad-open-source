import { describe, expect, it } from "vitest";
import { demoLifeMap } from "@brad/domain";
import { currentAnswer, parseInkusCatalog, toAnswer, type Answer } from "@brad/discovery";
import {
  DEMO_ANSWERS_DB,
  DEMO_QUESTIONS_DB,
  FakeInkus,
  loadCatalogRecords,
  recordToAnswer,
  seedDemoInkus,
  syncAnswers,
} from "../src";

async function setup() {
  const fake = await seedDemoInkus(new FakeInkus());
  const { catalog } = parseInkusCatalog(await loadCatalogRecords(fake, DEMO_QUESTIONS_DB));
  const run = (answers: Answer[]) => syncAnswers({ client: fake, databaseId: DEMO_ANSWERS_DB, catalog, answers, lifeMap: demoLifeMap });
  return { fake, catalog, run };
}

describe("answer sync with Inkus", () => {
  it("imports answers, reports scores that differ from the life map, and leaves the life map alone", async () => {
    const { run } = await setup();
    const { answers, report } = await run([]);
    expect(report).toMatchObject({ imported: 1, pushed: 0, updated: 0, skipped: 0 });
    expect(report.assessments).toEqual([{ domain: "work", field: "satisfaction", inkus: 6, local: 7, asOf: "2026-09-20T09:00:00.000Z" }]);
    expect(answers[0]).toMatchObject({ questionId: "goal.meaning", domain: "family", freeText: "Dinner together on weekdays", status: "self_reported" });
    // A second sync imports nothing new.
    expect((await run(answers)).report).toMatchObject({ imported: 0, pushed: 0 });
  });

  it("pushes a new answer that supersedes the imported one, once, with the question record and version", async () => {
    const { fake, catalog, run } = await setup();
    const first = await run([]);
    const imported = first.answers[0]!;
    const edit = toAnswer({ questionId: "goal.meaning", domain: "family", selectedOptionIds: ["opt_1"], otherText: "Sunday lunch" }, "local-1", "2026-09-27T10:00:00.000Z", catalog);
    const answers = [{ ...imported, status: "stale" as const }, edit];
    const second = await run(answers);
    expect(second.report).toMatchObject({ pushed: 1, imported: 0 });
    const rows = fake.databases[DEMO_ANSWERS_DB]!;
    const pushed = rows.at(-1)!;
    expect(pushed.fields).toMatchObject({
      question_id: "goal.meaning",
      question_record_id: catalog.get("goal.meaning")!.externalId,
      question_version: catalog.get("goal.meaning")!.version,
      selected_option_ids_json: '["opt_1","other"]',
      other_text: "Sunday lunch",
      supersedes_answer_id: imported.inkus!.recordId,
      epistemic_status: "self_reported",
    });
    // Running again (or retrying) does not duplicate the row.
    const again = await run(second.answers);
    expect(again.report.pushed).toBe(0);
    expect(rows.filter((r) => r.fields.other_text === "Sunday lunch")).toHaveLength(1);
  });

  it("writes a confirmation as a status update, and skips answers to questions outside the catalog", async () => {
    const { fake, run } = await setup();
    const first = await run([]);
    const confirmed = first.answers.map((a) => ({ ...a, status: "user_confirmed" as const }));
    const builtin: Answer = { ...confirmed[0]!, id: "b1", questionId: "meaning", inkus: undefined };
    const result = await run([...confirmed, builtin]);
    expect(result.report).toMatchObject({ updated: 1, pushed: 0 });
    expect(fake.databases[DEMO_ANSWERS_DB]!.find((r) => r.id === confirmed[0]!.inkus!.recordId)!.fields.epistemic_status).toBe("user_confirmed");
  });

  it("keeps a newer, unpushed local answer current and stores the Inkus row as history", async () => {
    const { catalog, run } = await setup();
    const mine = toAnswer({ questionId: "goal.meaning", domain: "family", freeText: "Mine, newer" }, "local-2", "2026-09-27T12:00:00.000Z", catalog);
    const { answers, report } = await run([mine]);
    expect(report).toMatchObject({ imported: 1, pushed: 1 });
    expect(currentAnswer(answers, "family", "goal.meaning")!.freeText).toBe("Mine, newer");
  });

  it("maps Inkus outcomes to Brad's universal ones", () => {
    const base = { question_id: "barrier.comb", domain: "health", answered_at: "2026-09-27T00:00:00Z" };
    expect(recordToAnswer({ id: "r1", fields: { ...base, selected_option_ids_json: '["unknown"]' } }).outcome).toBe("dont_know");
    expect(recordToAnswer({ id: "r2", fields: { ...base, selected_option_ids_json: '["skip"]' } }).outcome).toBe("prefer_not");
    expect(recordToAnswer({ id: "r3", fields: { ...base, selected_option_ids_json: '["opt_1","other"]', other_text: "x" } })).toMatchObject({
      outcome: "answered",
      selectedOptionIds: ["opt_1"],
      otherText: "x",
    });
  });
});
