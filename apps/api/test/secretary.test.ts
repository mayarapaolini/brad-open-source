import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("secretary API", () => {
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
  const ids = (state: { plan: { focus: { id: string }[] } }) => state.plan.focus.map((p) => p.id);

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  it("starts by asking, not acting", async () => {
    const { json } = await call("GET", "/api/secretary");
    expect(ids(json)).toEqual(["health:ask_meaning", "work:ask_preserve"]);
    expect(json.weeklyDue).toBe(true);
  });

  it("proposes the help the owner accepts once discovery answers exist", async () => {
    await call("POST", "/api/discovery/answers", { questionId: "meaning", domain: "health", selectedOptionIds: ["reduce_weight"] });
    await call("POST", "/api/discovery/answers", { questionId: "support", domain: "health", selectedOptionIds: ["organise"] });
    await call("POST", "/api/discovery/answers", { questionId: "preserve", domain: "work", selectedOptionIds: ["time"] });
    const { json } = await call("GET", "/api/secretary");
    expect(ids(json)).toEqual(["health:organise", "work:protect"]);
    expect(json.plan.protectedId).toBe("work:protect");
    expect(json.plan.focus[0].requiresApproval).toBe(true);
  });

  it("records accept, decline and snooze without acting, and never counts a decline as failure", async () => {
    const accepted = await call("POST", "/api/secretary/feedback", { proposalId: "health:organise", action: "accept" });
    expect(accepted.json.feedback["health:organise"].action).toBe("accept");
    const snoozed = await call("POST", "/api/secretary/feedback", { proposalId: "work:protect", action: "snooze" });
    expect(ids(snoozed.json)).toEqual(["health:organise"]);
    expect(snoozed.json.metrics).toEqual({ accepted: 1, edited: 0, declined: 0, snoozed: 1, total: 2 });
    expect(await call("POST", "/api/secretary/feedback", { proposalId: "nope", action: "accept" })).toMatchObject({ status: 404 });
    expect(await call("POST", "/api/secretary/feedback", { proposalId: "health:organise", action: "edit" })).toMatchObject({
      status: 400,
      json: { error: "note_required" },
    });
  });

  it("silences an area until the owner turns it back on", async () => {
    const silenced = await call("POST", "/api/secretary/silence", { domain: "health", silenced: true });
    expect(ids(silenced.json)).toEqual([]);
    expect(silenced.json.plan.hidden.silenced).toEqual(["health"]);
    const back = await call("POST", "/api/secretary/silence", { domain: "health", silenced: false });
    expect(ids(back.json)).toEqual(["health:organise"]);
  });

  it("records the optional weekly load check-in", async () => {
    const res = await call("POST", "/api/secretary/checkin", { load: "lighter" });
    expect(res.json.checkins[0].load).toBe("lighter");
    expect(res.json.weeklyDue).toBe(false);
    expect(await call("POST", "/api/secretary/checkin", { load: "great" })).toMatchObject({ status: 400 });
  });
});
