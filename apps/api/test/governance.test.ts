import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("agent governance API", () => {
  const store = new Store(":memory:");
  const server = createApiServer(store);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON responses
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  }

  const move = (to: string) => call("POST", "/api/agents/transition", { agentId: "agent-family", to });
  const policy = () =>
    call("POST", "/api/simulate/policy", {
      request: { agentId: "agent-family", capability: "draft_reply", domain: "family" },
    });

  it("walks an agent from draft to active only when each requirement is met", async () => {
    expect((await move("active")).json.result).toMatchObject({ ok: false, reason: "not_allowed" });
    expect((await move("configured")).json.result).toEqual({ ok: true });
    expect((await move("simulated")).json.result).toMatchObject({ ok: false, reason: "not_simulated" });

    expect((await policy()).json.decision).toMatchObject({ outcome: "deny", decidedBy: "agent_state" });
    expect((await move("simulated")).json.result).toEqual({ ok: true });
    expect((await move("approved")).json.result).toEqual({ ok: true });

    // The demo grant for draft_reply is current, so the agent may now act.
    expect((await policy()).json.decision).toMatchObject({ outcome: "allow" });
    expect((await move("active")).json.agent.state).toBe("active");
  });

  it("grants only requested, allowed capabilities and never duplicates them", async () => {
    const forbidden = await call("POST", "/api/grants", { agentId: "agent-finances", capability: "make_payment" });
    expect(forbidden).toMatchObject({ status: 409, json: { error: "capability_forbidden" } });

    const notRequested = await call("POST", "/api/grants", { agentId: "agent-family", capability: "create_event" });
    expect(notRequested).toMatchObject({ status: 409, json: { error: "capability_not_requested" } });

    const duplicate = await call("POST", "/api/grants", { agentId: "agent-family", capability: "draft_reply" });
    expect(duplicate).toMatchObject({ status: 409, json: { error: "grant_exists" } });

    const created = await call("POST", "/api/grants", { agentId: "agent-family", capability: "read_messages", days: 7 });
    expect(created.status).toBe(200);
    expect(created.json.grant).toMatchObject({ capability: "read_messages", revokedAt: null });
  });

  it("revoking a grant immediately denies the action", async () => {
    const grants = (await call("GET", "/api/agents")).json.grants as { id: string; agentId: string; capability: string }[];
    const grant = grants.find((g) => g.agentId === "agent-family" && g.capability === "draft_reply")!;
    await call("POST", "/api/grants/revoke", { grantId: grant.id });
    expect((await policy()).json.decision).toMatchObject({ outcome: "deny", decidedBy: "grant_valid" });
  });

  it("records lifecycle and grant events in the audit history", async () => {
    const kinds = ((await call("GET", "/api/decisions")).json.decisions as { kind: string }[]).map((d) => d.kind);
    expect(kinds).toContain("lifecycle");
    expect(kinds).toContain("grant");
  });

  it("regenerating keeps the owner's decisions", async () => {
    const res = await call("POST", "/api/agents/generate");
    expect((res.json.agents as { id: string; state: string }[]).find((a) => a.id === "agent-family")?.state).toBe("active");
  });

  it("exports and re-imports, pausing active agents", async () => {
    const snapshot = (await call("GET", "/api/export")).json;
    expect(snapshot.format).toBe("brad-export");
    await call("DELETE", "/api/data");
    expect((await call("POST", "/api/import", { ...snapshot, version: 2 })).status).toBe(400);

    const imported = await call("POST", "/api/import", snapshot);
    expect(imported.status).toBe(200);
    expect(imported.json.lifeMap.owner.displayName).toBe("Alex (demo)");
    expect((imported.json.agents as { id: string; state: string }[]).find((a) => a.id === "agent-family")?.state).toBe(
      "paused",
    );
  });
});
