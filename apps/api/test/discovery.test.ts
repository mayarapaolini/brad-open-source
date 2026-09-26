import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("discovery API", () => {
  const store = new Store(":memory:");
  const server = createApiServer(store);
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
    state.domains.find((d) => d.domain === id) as unknown as { path: string; next: { id: string } | null; done: number };

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  it("plans a path per domain from the life map", async () => {
    const { json } = await call("GET", "/api/discovery");
    expect(domain(json, "health")).toMatchObject({ path: "struggling", next: { id: "meaning" } });
    expect(domain(json, "work")).toMatchObject({ path: "thriving", next: { id: "preserve" } });
    expect(domain(json, "family")).toMatchObject({ path: "middle", next: { id: "change_desire" } });
    expect(json.estimate).toBeGreaterThan(0);
  });

  it("accepts 'Outra resposta' text and moves to the next question", async () => {
    const { status, json } = await call("POST", "/api/discovery/answers", {
      questionId: "meaning",
      domain: "health",
      otherText: "More weekends without screens",
    });
    expect(status).toBe(200);
    expect(domain(json, "health")).toMatchObject({ done: 1, next: { id: "barrier" } });
    expect(json.synthesis).toEqual([expect.objectContaining({ id: "health:priority", status: "inferred" })]);
  });

  it("keeps history when an answer is edited", async () => {
    await call("POST", "/api/discovery/answers", { questionId: "meaning", domain: "health", selectedOptionIds: ["gain_time"] });
    const all = store.getAnswers().filter((a) => a.domain === "health" && a.questionId === "meaning");
    expect(all.map((a) => a.status)).toEqual(["stale", "self_reported"]);
    // "gain_time" triggers the improvement follow-up.
    expect(domain((await call("GET", "/api/discovery")).json, "health").next?.id).toBe("improvement");
  });

  it("lets the owner skip or prefer not to answer", async () => {
    const skipped = await call("POST", "/api/discovery/answers", { questionId: "improvement", domain: "health", outcome: "skipped" });
    expect(domain(skipped.json, "health").next?.id).toBe("barrier");
    const prefer = await call("POST", "/api/discovery/answers", { questionId: "barrier", domain: "health", outcome: "prefer_not" });
    expect(domain(prefer.json, "health").next?.id).toBe("competence");
  });

  it("validates answers", async () => {
    expect(await call("POST", "/api/discovery/answers", { questionId: "meaning", domain: "health" })).toMatchObject({
      status: 400,
      json: { error: "empty_answer" },
    });
    expect(await call("POST", "/api/discovery/answers", { questionId: "nope", domain: "health", freeText: "x" })).toMatchObject({
      status: 400,
      json: { error: "unknown_question" },
    });
  });

  it("confirms or corrects the synthesis and marks the answers accordingly", async () => {
    const res = await call("POST", "/api/discovery/synthesis", { itemId: "health:priority", verdict: "partly", correction: "Mostly Sundays" });
    const item = (res.json.synthesis as { id: string; status: string; correction: string | null }[]).find((i) => i.id === "health:priority");
    expect(item).toMatchObject({ status: "corrected", correction: "Mostly Sundays" });
    const basis = store.getAnswers().find((a) => a.questionId === "meaning" && a.status !== "stale");
    expect(basis?.status).toBe("corrected");
    expect(await call("POST", "/api/discovery/synthesis", { itemId: "nope", verdict: "yes" })).toMatchObject({ status: 404 });
  });

  it("stores per-answer Inkus consent, off by default", async () => {
    const answers = (await call("GET", "/api/discovery")).json.answers as { id: string; syncToInkus: boolean }[];
    expect(answers.every((a) => a.syncToInkus === false)).toBe(true);
    const res = await call("POST", "/api/discovery/answers/sync", { answerId: answers[0]!.id, syncToInkus: true });
    expect((res.json.answers as { id: string; syncToInkus: boolean }[]).find((a) => a.id === answers[0]!.id)?.syncToInkus).toBe(true);
  });
});
