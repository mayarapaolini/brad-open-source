import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../src/server";
import { MAX_SNAPSHOTS, Store } from "../src/store";

describe("contexts, sharing and version restore", () => {
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
  const answer = (questionId: string, domain: string, selectedOptionIds: string[] = [], otherText = "") =>
    call("POST", "/api/discovery/answers", { questionId, domain, selectedOptionIds, otherText, outcome: "answered" });
  const ids = (plan: { focus: { id: string }[] }) => plan.focus.map((p) => p.id);

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
    await answer("preserve", "work", ["time"]);
    await answer("meaning", "health", [], "Walk after lunch");
    await answer("support", "health", ["show_options"]);
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  it("filters the secretary to one context and remembers the choice", async () => {
    expect(ids((await call("GET", "/api/secretary")).json.plan)).toEqual(["health:show_options", "work:protect"]);
    const work = await call("POST", "/api/secretary/context", { context: "work" });
    expect(work.json.context).toBe("work");
    expect(ids(work.json.plan)).toEqual(["work:protect"]);
    const personal = await call("POST", "/api/secretary/context", { context: "personal" });
    expect(ids(personal.json.plan)).toEqual(["health:show_options"]);
    expect((await call("GET", "/api/secretary")).json.context).toBe("personal");
    expect((await call("POST", "/api/secretary/context", { context: "office" })).status).toBe(400);
    await call("POST", "/api/secretary/context", { context: "all" });
  });

  it("prepares a summary to share without sensitive areas unless consented, and logs areas, not content", async () => {
    const plain = await call("POST", "/api/share/summary", { audience: "personal", consents: [] });
    expect(plain.status).toBe(200);
    expect(plain.json.lines.map((l: { domain: string }) => l.domain)).not.toContain("health");
    expect(plain.json.excluded).toContainEqual({ domain: "health", reason: "sensitive" });
    expect(plain.json.excluded).toContainEqual({ domain: "work", reason: "other_context" });
    expect(JSON.stringify(plain.json)).not.toContain("Walk after lunch");

    const consented = await call("POST", "/api/share/summary", { audience: "personal", consents: ["health"] });
    expect(consented.json.lines.find((l: { domain: string }) => l.domain === "health")).toMatchObject({ focus: "show_options" });

    const work = await call("POST", "/api/share/summary", { audience: "work", consents: ["health"] });
    expect(work.json.lines.map((l: { domain: string }) => l.domain)).toEqual(["work", "study"]);

    const decisions = (await call("GET", "/api/decisions")).json.decisions as { kind: string; input: unknown; result: unknown }[];
    const share = decisions.filter((d) => d.kind === "share");
    expect(share).toHaveLength(3);
    expect(share[1]).toMatchObject({ input: { audience: "personal", consents: ["health"] } });
    expect(JSON.stringify(share)).not.toContain("Walk after lunch");
    expect((await call("POST", "/api/share/summary", { audience: "everyone" })).status).toBe(400);
  });

  it("keeps the previous life map on every real change and restores it on request, undoably", async () => {
    const before = (await call("GET", "/api/lifemap")).json.lifeMap;
    const unchanged = (await call("GET", "/api/snapshots")).json.snapshots.length;
    await call("PUT", "/api/lifemap", { lifeMap: before });
    expect((await call("GET", "/api/snapshots")).json.snapshots.length).toBe(unchanged);

    const edited = { ...before, owner: { displayName: "Changed" } };
    await call("PUT", "/api/lifemap", { lifeMap: edited });
    const [latest] = (await call("GET", "/api/snapshots")).json.snapshots;
    expect(latest).toMatchObject({ reason: "before_lifemap_save", people: before.people.length });

    const restored = await call("POST", "/api/snapshots/restore", { snapshotId: latest.id, scope: "lifeMap" });
    expect(restored.json.lifeMap.owner.displayName).toBe(before.owner.displayName);
    const undo = await call("POST", "/api/snapshots/restore", { snapshotId: restored.json.snapshotId, scope: "lifeMap" });
    expect(undo.json.lifeMap.owner.displayName).toBe("Changed");
    await call("PUT", "/api/lifemap", { lifeMap: before });
  });

  it("restores an earlier set of answers without touching the life map", async () => {
    const current = () => call("GET", "/api/discovery").then((r) => r.json.answers.filter((a: { status: string }) => a.status !== "stale"));
    const beforeCount = (await current()).length;
    await answer("frequency", "health", ["this_week"]);
    expect((await current()).length).toBe(beforeCount + 1);

    const [latest] = (await call("GET", "/api/snapshots")).json.snapshots;
    expect(latest).toMatchObject({ reason: "before_answer", answers: beforeCount });
    const map = (await call("GET", "/api/lifemap")).json.lifeMap;
    await call("POST", "/api/snapshots/restore", { snapshotId: latest.id, scope: "answers" });
    expect((await current()).length).toBe(beforeCount);
    expect((await call("GET", "/api/lifemap")).json.lifeMap).toEqual(map);

    const decisions = (await call("GET", "/api/decisions")).json.decisions as { kind: string; input: { action?: string; scope?: string } }[];
    expect(decisions[0]).toMatchObject({ kind: "import", input: { action: "restore", scope: "answers" } });
    expect((await call("POST", "/api/snapshots/restore", { snapshotId: latest.id, scope: "everything" })).status).toBe(400);
  });

  it(`keeps at most ${MAX_SNAPSHOTS} versions`, () => {
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) store.createSnapshot("test");
    expect(store.listSnapshots(1000)).toHaveLength(MAX_SNAPSHOTS);
  });
});
