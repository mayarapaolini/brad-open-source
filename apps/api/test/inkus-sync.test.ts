import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeInkus, seedDemoInkus } from "@brad/adapter-inkus";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("Inkus sync API", () => {
  const store = new Store(":memory:");
  const fake = new FakeInkus();
  const server = createApiServer(store, { inkus: async () => fake });
  const disabled = createApiServer(new Store(":memory:"));
  let base = "";
  let disabledBase = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON responses
  async function call(method: string, path: string, body?: unknown, root = base): Promise<{ status: number; json: any }> {
    const res = await fetch(root + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  beforeAll(async () => {
    await seedDemoInkus(fake);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    await new Promise<void>((done) => disabled.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    disabledBase = `http://127.0.0.1:${(disabled.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
  });
  afterAll(() => {
    server.close();
    disabled.close();
    store.close();
  });

  it("reports the adapter as disabled when not configured", async () => {
    expect((await call("GET", "/api/adapters/inkus", undefined, disabledBase)).json.enabled).toBe(false);
    expect(await call("POST", "/api/adapters/inkus/sync", undefined, disabledBase)).toMatchObject({
      status: 409,
      json: { error: "adapter_disabled" },
    });
  });

  it("imports Inkus agents and links Brad agents of the same domain, without creating anything in Inkus", async () => {
    const actorsBefore = fake.actors.length;
    const { status, json } = await call("POST", "/api/adapters/inkus/sync");
    expect(status).toBe(200);
    // Demo profile agents for family and health are linked to their Inkus twins; the cross-cutting ones are imported.
    expect(json.report.adopted.sort()).toEqual(["agent-family", "agent-health"]);
    expect(json.report.imported).toHaveLength(2);
    expect(fake.actors.length).toBe(actorsBefore);
    expect((await call("GET", "/api/adapters/inkus")).json.lastSync.kind).toBe("sync");
  });

  it("creates an Inkus agent only on explicit export", async () => {
    const res = await call("POST", "/api/adapters/inkus/export", { agentId: "agent-work" });
    expect(res.status).toBe(200);
    const actor = fake.actors.find((a) => a.id === res.json.agent.inkus.actorId)!;
    expect(actor.name).toBe("Brad Work");
    const spec = await fake.getActiveSpec(actor.id);
    expect((spec?.capabilities as { brad: { domain: string } }).brad.domain).toBe("work");
    expect(await call("POST", "/api/adapters/inkus/export", { agentId: "agent-work" })).toMatchObject({
      status: 409,
      json: { error: "already_linked" },
    });
  });

  it("round-trips edits in both directions", async () => {
    const agents = (await call("GET", "/api/agents")).json.agents as { id: string; name?: string; inkus: { actorId: string } }[];
    const orchestrator = agents.find((a) => a.name === "Demo Life Orchestrator")!;

    // Edit in Brad → pushed to Inkus.
    const edit = await call("POST", "/api/agents/update", {
      agentId: orchestrator.id,
      patch: { goal: "Edited in Brad", actionDomains: ["work"], requestedCapabilities: ["read_calendar", "make_payment"] },
    });
    expect(edit.json.agent).toMatchObject({ requestedCapabilities: ["read_calendar"], excludedByBoundary: ["make_payment"] });
    const pushed = await call("POST", "/api/adapters/inkus/sync");
    expect(pushed.json.report.pushed).toEqual([orchestrator.id]);
    expect((await fake.getActiveSpec(orchestrator.inkus.actorId))?.mission).toBe("Edited in Brad");

    // Edit in Inkus → applied in Brad.
    await fake.editInInkus(orchestrator.inkus.actorId, { mission: "Edited in Inkus" });
    const pulled = await call("POST", "/api/adapters/inkus/sync");
    expect(pulled.json.report.updated).toEqual([orchestrator.id]);
    const after = (pulled.json.agents as { id: string; goal: string }[]).find((a) => a.id === orchestrator.id);
    expect(after?.goal).toBe("Edited in Inkus");
  });

  it("revokes grants when an edit drops the capability", async () => {
    const agents = (await call("GET", "/api/agents")).json.agents as { id: string; name?: string }[];
    const family = agents.find((a) => a.id === "agent-family")!;
    // The demo already granted draft_reply to the family agent.
    const res = await call("POST", "/api/agents/update", { agentId: family.id, patch: { requestedCapabilities: ["read_messages"] } });
    const grant = (res.json.grants as { agentId: string; capability: string; revokedAt: string | null }[]).find(
      (g) => g.agentId === family.id && g.capability === "draft_reply",
    );
    expect(grant?.revokedAt).not.toBeNull();
  });

  it("validates edits", async () => {
    expect(await call("POST", "/api/agents/update", { agentId: "agent-family", patch: { domain: "mars" } })).toMatchObject({
      status: 400,
      json: { error: "unknown_domain" },
    });
    expect(await call("POST", "/api/agents/update", { agentId: "nope", patch: {} })).toMatchObject({ status: 404 });
  });

  it("reports an unreachable Inkus without touching local data", async () => {
    const failing = createApiServer(store, {
      inkus: async () => {
        throw new Error("connection refused");
      },
    });
    await new Promise<void>((done) => failing.listen(0, "127.0.0.1", done));
    const root = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`;
    const before = (await call("GET", "/api/agents")).json.agents.length;
    expect(await call("POST", "/api/adapters/inkus/sync", undefined, root)).toMatchObject({
      status: 502,
      json: { error: "inkus_unreachable", details: ["connection refused"] },
    });
    expect((await call("GET", "/api/agents")).json.agents.length).toBe(before);
    failing.close();
  });
});
