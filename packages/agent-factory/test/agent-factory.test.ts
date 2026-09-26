import { describe, expect, it } from "vitest";
import { demoLifeMap, emptyLifeMap } from "@brad/domain";
import { generateDraftAgents, reconcileAgents } from "../src";

describe("generateDraftAgents", () => {
  const agents = generateDraftAgents(demoLifeMap);

  it("only proposes drafts that hold no permissions", () => {
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent.state).toBe("draft");
      expect(agent).not.toHaveProperty("grants");
      expect(agent.escalation).toBe("ask_owner");
    }
  });

  it("covers important or neglected domains, ordered by need", () => {
    expect(agents.map((a) => a.domain)).toEqual(["family", "health", "work", "study", "finances", "social"]);
    expect(agents.find((a) => a.domain === "family")?.reason).toBe("importance_and_gap");
    expect(agents.find((a) => a.domain === "work")?.reason).toBe("importance");
  });

  it("never requests a capability the owner forbade", () => {
    const finances = agents.find((a) => a.domain === "finances");
    expect(finances?.requestedCapabilities).toEqual(["read_messages"]);
    expect(finances?.excludedByBoundary).toEqual(["make_payment"]);
  });

  it("is deterministic", () => {
    expect(generateDraftAgents(structuredClone(demoLifeMap))).toEqual(agents);
  });

  it("proposes nothing when no domain stands out", () => {
    expect(generateDraftAgents(emptyLifeMap())).toEqual([]);
  });
});

describe("reconcileAgents", () => {
  const proposed = generateDraftAgents(demoLifeMap);

  it("keeps the owner's decisions when nothing changed", () => {
    const existing = proposed.map((a) => (a.id === "agent-family" ? { ...a, state: "active" as const } : a));
    const result = reconcileAgents(existing, proposed);
    expect(result.agents.find((a) => a.id === "agent-family")?.state).toBe("active");
    expect(result.reset).toEqual([]);
    expect(result.archived).toEqual([]);
  });

  it("sends an approved agent back to review when its capabilities change", () => {
    const existing = proposed.map((a) => (a.id === "agent-work" ? { ...a, state: "approved" as const } : a));
    const map = structuredClone(demoLifeMap);
    map.boundaries.forbiddenCapabilities.push("create_event");
    const result = reconcileAgents(existing, generateDraftAgents(map));
    expect(result.agents.find((a) => a.id === "agent-work")?.state).toBe("configured");
    expect(result.reset).toContain("agent-work");
  });

  it("archives agents the life map no longer justifies instead of deleting them", () => {
    const map = structuredClone(demoLifeMap);
    const social = map.assessments.find((a) => a.domain === "social")!;
    social.importance = 3;
    const result = reconcileAgents(proposed, generateDraftAgents(map));
    expect(result.archived).toEqual(["agent-social"]);
    expect(result.agents.find((a) => a.id === "agent-social")?.state).toBe("archived");
  });
});
