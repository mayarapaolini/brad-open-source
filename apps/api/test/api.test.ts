import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoLifeMap } from "@brad/domain";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("Store", () => {
  it("round-trips the life map, agents, grants and decisions", () => {
    const store = new Store(":memory:");
    expect(store.getLifeMap()).toBeNull();
    store.saveLifeMap(demoLifeMap);
    expect(store.getLifeMap()).toEqual(demoLifeMap);
    const record = store.addDecision("priority", { a: 1 }, { b: 2 });
    expect(store.listDecisions()).toEqual([record]);
    store.reset();
    expect(store.getLifeMap()).toBeNull();
    expect(store.listDecisions()).toEqual([]);
    store.close();
  });
});

describe("API", () => {
  const store = new Store(":memory:");
  const server = createApiServer(store);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("refuses simulations before a life map exists", async () => {
    expect((await call("POST", "/api/simulate/priority")).status).toBe(409);
  });

  it("loads the demo and ranks the family message first", async () => {
    const loaded = await call("POST", "/api/demo/load");
    expect((loaded.json.agents as { state: string }[]).every((a) => a.state === "draft")).toBe(true);

    const { status, json } = await call("POST", "/api/simulate/priority");
    expect(status).toBe(200);
    const ranked = json.ranked as { item: { id: string } }[];
    expect(ranked[0]?.item.id).toBe("i-family");

    const decisions = (await call("GET", "/api/decisions")).json.decisions as { kind: string }[];
    expect(decisions[0]?.kind).toBe("priority");
  });

  it("evaluates policy what-ifs without changing stored agents", async () => {
    const request = { agentId: "agent-family", capability: "send_message", domain: "family" };
    const now = "2026-03-10T08:30:00-03:00";

    const asDraft = await call("POST", "/api/simulate/policy", { request, now });
    expect(asDraft.json.decision).toMatchObject({ outcome: "deny", decidedBy: "agent_state" });

    const approved = await call("POST", "/api/simulate/policy", { request, now, assumeState: "approved", assumeGrant: true });
    expect(approved.json.decision).toMatchObject({ outcome: "confirm", decidedBy: "consequential_action" });

    const agents = (await call("GET", "/api/agents")).json.agents as { id: string; state: string }[];
    expect(agents.find((a) => a.id === "agent-family")?.state).toBe("draft");
  });

  it("assumeGrant ignores a revoked grant and still simulates a fresh one", async () => {
    const request = { agentId: "agent-family", capability: "read_calendar", domain: "family" };
    const now = "2026-03-10T08:30:00-03:00";
    const day = 24 * 60 * 60 * 1000;
    store.saveGrant({
      id: "g-revoked-test",
      agentId: "agent-family",
      capability: "read_calendar",
      purpose: "test",
      issuedAt: new Date(Date.parse(now) - 10 * day).toISOString(),
      expiresAt: new Date(Date.parse(now) + 10 * day).toISOString(),
      revokedAt: new Date(Date.parse(now) - 1 * day).toISOString(),
    });
    const countBefore = ((await call("GET", "/api/agents")).json.grants as unknown[]).length;

    const withoutAssume = await call("POST", "/api/simulate/policy", { request, now, assumeState: "approved" });
    expect((withoutAssume.json.decision as { outcome: string; decidedBy: string }).decidedBy).toBe("grant_valid");
    expect((withoutAssume.json.decision as { outcome: string }).outcome).toBe("deny");

    const withAssume = await call("POST", "/api/simulate/policy", { request, now, assumeState: "approved", assumeGrant: true });
    const decision = withAssume.json.decision as { outcome: string; decidedBy: string; trace: { rule: string; status: string; params: Record<string, string> }[] };
    expect(decision.outcome).toBe("allow");
    expect(decision.decidedBy).toBe("all_rules_passed");
    expect(decision.trace).toContainEqual(
      expect.objectContaining({ rule: "grant_present", status: "pass", params: { grantId: "g-simulated" } }),
    );

    // The simulation must never persist the simulated grant back to the store.
    const grants = (await call("GET", "/api/agents")).json.grants as { id: string }[];
    expect(grants.length).toBe(countBefore);
    expect(grants.map((g) => g.id)).toContain("g-revoked-test");
    expect(grants.map((g) => g.id)).not.toContain("g-simulated");
  });

  it("assumeGrant ignores an expired grant and still simulates a fresh one", async () => {
    const request = { agentId: "agent-family", capability: "read_messages", domain: "family" };
    const now = "2026-03-10T08:30:00-03:00";
    const day = 24 * 60 * 60 * 1000;
    store.saveGrant({
      id: "g-expired-test",
      agentId: "agent-family",
      capability: "read_messages",
      purpose: "test",
      issuedAt: new Date(Date.parse(now) - 40 * day).toISOString(),
      expiresAt: new Date(Date.parse(now) - 10 * day).toISOString(),
      revokedAt: null,
    });
    const countBefore = ((await call("GET", "/api/agents")).json.grants as unknown[]).length;

    const withoutAssume = await call("POST", "/api/simulate/policy", { request, now, assumeState: "approved" });
    expect((withoutAssume.json.decision as { decidedBy: string }).decidedBy).toBe("grant_valid");

    const withAssume = await call("POST", "/api/simulate/policy", { request, now, assumeState: "approved", assumeGrant: true });
    const decision = withAssume.json.decision as { outcome: string; decidedBy: string; trace: { rule: string; status: string; params: Record<string, string> }[] };
    expect(decision.outcome).toBe("allow");
    expect(decision.decidedBy).toBe("all_rules_passed");
    expect(decision.trace).toContainEqual(
      expect.objectContaining({ rule: "grant_present", status: "pass", params: { grantId: "g-simulated" } }),
    );

    const grants = (await call("GET", "/api/agents")).json.grants as { id: string }[];
    expect(grants.length).toBe(countBefore);
    expect(grants.map((g) => g.id)).toContain("g-expired-test");
    expect(grants.map((g) => g.id)).not.toContain("g-simulated");
  });

  it("assumeGrant does not duplicate or alter an already-valid grant", async () => {
    const request = { agentId: "agent-family", capability: "send_message", domain: "family" };
    const now = "2026-03-10T08:30:00-03:00";
    const day = 24 * 60 * 60 * 1000;
    store.saveGrant({
      id: "g-valid-test",
      agentId: "agent-family",
      capability: "send_message",
      purpose: "test",
      issuedAt: new Date(Date.parse(now) - 1 * day).toISOString(),
      expiresAt: new Date(Date.parse(now) + 29 * day).toISOString(),
      revokedAt: null,
    });

    const before = (await call("GET", "/api/agents")).json.grants as { id: string }[];
    expect(before.map((g) => g.id)).toContain("g-valid-test");

    const withAssume = await call("POST", "/api/simulate/policy", { request, now, assumeState: "approved", assumeGrant: true });
    expect((withAssume.json.decision as { decidedBy: string }).decidedBy).not.toBe("grant_valid");
    expect((withAssume.json.decision as { decidedBy: string }).decidedBy).not.toBe("grant_present");

    // Full object equality, not just ids - nothing about the existing grant (dates, revokedAt, purpose) changed either.
    const after = (await call("GET", "/api/agents")).json.grants as { id: string }[];
    expect(after).toEqual(before);
  });

  it("rejects invalid life maps with details", async () => {
    const { status, json } = await call("PUT", "/api/lifemap", { lifeMap: { ...demoLifeMap, schemaVersion: 2 } });
    expect(status).toBe(400);
    expect(json.details).toEqual(["schemaVersion must be 1"]);
  });

  it("refuses non-local Host headers", async () => {
    // fetch() may not override Host, so use a raw request.
    const status = await new Promise<number | undefined>((done, fail) => {
      request(`${base}/api/health`, { headers: { host: "evil.example" } }, (res) => {
        res.resume();
        done(res.statusCode);
      })
        .on("error", fail)
        .end();
    });
    expect(status).toBe(403);
  });
});
