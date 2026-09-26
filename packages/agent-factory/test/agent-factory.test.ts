import { describe, expect, it } from "vitest";
import { demoLifeMap, emptyLifeMap } from "@brad/domain";
import { generateDraftAgents } from "../src";

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
