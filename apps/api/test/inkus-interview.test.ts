import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_ANSWERS_DB, DEMO_QUESTIONS_DB, FakeInkus, seedDemoInkus } from "@brad/adapter-inkus";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("interview from the Inkus catalog", () => {
  const store = new Store(":memory:");
  const fake = new FakeInkus();
  let reachable = true;
  const server = createApiServer(store, {
    inkus: async () => {
      if (!reachable) throw new Error("offline");
      return fake;
    },
    inkusDatabases: { questions: DEMO_QUESTIONS_DB, answers: DEMO_ANSWERS_DB },
  });
  let base = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON responses
  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }
  const domain = (state: { domains: { domain: string }[] }, id: string) =>
    state.domains.find((d) => d.domain === id) as unknown as { next: { id: string } | null; total: number };

  beforeAll(async () => {
    await seedDemoInkus(fake);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  it("starts with the built-in catalog and refuses to switch before the Inkus catalog is loaded", async () => {
    const state = (await call("GET", "/api/discovery")).json;
    expect(state.catalog.source).toBe("builtin");
    expect((await call("POST", "/api/discovery/catalog", { source: "inkus" })).json.error).toBe("catalog_not_loaded");
    expect((await call("GET", "/api/adapters/inkus")).json.interview).toBe(true);
  });

  it("loads the questions from Inkus, switches to them and plans the interview from branch rules", async () => {
    const loaded = await call("POST", "/api/adapters/inkus/questions");
    expect(loaded.status).toBe(200);
    expect(loaded.json.catalog).toMatchObject({ source: "builtin", errors: [] });
    const state = (await call("POST", "/api/discovery/catalog", { source: "inkus" })).json;
    expect(state.catalog.source).toBe("inkus");
    expect(state.catalog.fetchedAt).toBeTruthy();
    expect(domain(state, "family").next!.id).toBe("goal.meaning");
  });

  it("imports the Inkus answers, reports differing scores, then pushes new answers", async () => {
    const pulled = await call("POST", "/api/adapters/inkus/answers");
    expect(pulled.status).toBe(200);
    expect(pulled.json.lastAnswerSync.report).toMatchObject({
      imported: 1,
      pushed: 0,
      assessments: [{ domain: "work", field: "satisfaction", inkus: 6, local: 7 }],
    });
    // The imported goal answers family's first question; the next one comes from the catalog.
    expect(domain(pulled.json, "family").next!.id).toBe("priority.protect_or_change");

    const answered = await call("POST", "/api/discovery/answers", {
      questionId: "priority.protect_or_change",
      domain: "family",
      selectedOptionIds: ["opt_1"],
    });
    expect(answered.json.pendingSync).toBe(1);
    const pushed = await call("POST", "/api/adapters/inkus/answers");
    expect(pushed.json).toMatchObject({ pendingSync: 0, lastAnswerSync: { report: { pushed: 1 } } });
    expect(fake.databases[DEMO_ANSWERS_DB]!.at(-1)!.fields).toMatchObject({ question_id: "priority.protect_or_change", domain: "family" });
  });

  it("feeds the secretary from Inkus answers", async () => {
    await call("POST", "/api/discovery/answers", { questionId: "goal.meaning", domain: "health", freeText: "Dormir melhor" });
    await call("POST", "/api/discovery/answers", { questionId: "help.preference", domain: "health", selectedOptionIds: ["opt_4"] });
    const plan = (await call("GET", "/api/secretary")).json.plan;
    expect(plan.focus.map((p: { id: string }) => p.id)).toContain("health:prepare_draft");
  });

  it("keeps the last catalog when Inkus is unreachable and says so", async () => {
    reachable = false;
    const failed = await call("POST", "/api/adapters/inkus/questions");
    expect(failed).toMatchObject({ status: 502, json: { error: "inkus_questions_failed" } });
    const state = (await call("GET", "/api/discovery")).json;
    expect(state.catalog.source).toBe("inkus");
    expect(state.catalog.lastLoad.error).toContain("offline");
    reachable = true;
  });

  it("flags answers given to an earlier wording of a question", async () => {
    const rows = fake.databases[DEMO_QUESTIONS_DB]!;
    const help = rows.find((r) => r.fields.question_id === "help.preference")!;
    help.fields = { ...help.fields, prompt_pt_br: "Como posso ajudar aqui?" };
    const state = (await call("POST", "/api/adapters/inkus/questions")).json;
    const helpAnswer = state.answers.find((a: { questionId: string }) => a.questionId === "help.preference");
    expect(state.changed).toContain(helpAnswer.id);
  });
});
