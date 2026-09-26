import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiServer } from "../src/server";
import { Store } from "../src/store";

describe("correction loop API", () => {
  const store = new Store(":memory:");
  const server = createApiServer(store);
  let base = "";
  let decisionId = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON responses
  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call("POST", "/api/demo/load");
    decisionId = (await call("POST", "/api/simulate/priority")).json.decisionId;
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  it("validates the feedback", async () => {
    const policy = await call("POST", "/api/simulate/policy", {
      request: { agentId: "agent-family", capability: "draft_reply", domain: "family" },
    });
    const cases: [unknown, number, string][] = [
      [{ decisionId: 9999, itemId: "i-manager", expectedTier: "now" }, 404, "decision_not_found"],
      [{ decisionId: policy.json.decisionId, itemId: "i-manager", expectedTier: "now" }, 400, "not_a_priority_decision"],
      [{ decisionId, itemId: "i-ghost", expectedTier: "now" }, 400, "item_not_in_decision"],
      [{ decisionId, itemId: "i-manager", expectedTier: "today" }, 400, "same_tier"],
      [{ decisionId, itemId: "i-manager", expectedTier: "urgent" }, 400, "unknown_tier"],
      [{ decisionId, itemId: "i-manager", expectedTier: "now", note: "x".repeat(501) }, 400, "note_too_long"],
    ];
    for (const [body, status, error] of cases) {
      expect(await call("POST", "/api/corrections", body)).toMatchObject({ status, json: { error } });
    }
  });

  it("records feedback, suggests a change and applies it only on request", async () => {
    const feedback = await call("POST", "/api/corrections", {
      decisionId,
      itemId: "i-manager",
      expectedTier: "now",
      note: "My manager's evening emails matter",
    });
    expect(feedback.json.suggestion).toMatchObject({
      change: "allow_quiet_hours_bypass",
      projected: { score: 86, tier: "now" },
    });
    // Feedback alone never changes the life map.
    const before = (await call("GET", "/api/lifemap")).json.lifeMap;
    expect(before.people.find((p: { id: string }) => p.id === "p-jordan").bypassQuietHours).toBe(false);

    const applied = await call("POST", "/api/corrections/apply", { correctionId: feedback.json.correctionId });
    expect(applied.status).toBe(200);
    const ranked = (await call("POST", "/api/simulate/priority")).json.ranked as { item: { id: string }; tier: string }[];
    expect(ranked.find((r) => r.item.id === "i-manager")?.tier).toBe("now");

    // Applying the same correction twice is refused: the map has moved on.
    const again = await call("POST", "/api/corrections/apply", { correctionId: feedback.json.correctionId });
    expect(again).toMatchObject({ status: 409, json: { error: "stale_correction" } });

    const kinds = (await call("GET", "/api/decisions")).json.decisions
      .filter((d: { kind: string }) => d.kind === "correction")
      .map((d: { input: { action: string } }) => d.input.action);
    expect(kinds).toEqual(["apply", "feedback"]);
  });

  it("refuses to apply manual changes", async () => {
    const map = (await call("GET", "/api/lifemap")).json.lifeMap;
    map.assessments.find((a: { domain: string }) => a.domain === "work").importance = 10;
    await call("PUT", "/api/lifemap", { lifeMap: map });
    const id = (await call("POST", "/api/simulate/priority")).json.decisionId;
    const feedback = await call("POST", "/api/corrections", { decisionId: id, itemId: "i-newsletter", expectedTier: "today" });
    expect(feedback.json.suggestion).toMatchObject({ change: "add_person", projected: null });
    const applied = await call("POST", "/api/corrections/apply", { correctionId: feedback.json.correctionId });
    expect(applied).toMatchObject({ status: 409, json: { error: "manual_change" } });
  });
});
