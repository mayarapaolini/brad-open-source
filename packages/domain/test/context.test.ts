import { describe, expect, it } from "vitest";
import { agentContexts, demoLifeMap, domainContext, validateLifeMap, type AgentDefinition } from "../src";

describe("life contexts", () => {
  const b = demoLifeMap.boundaries;

  it("puts work and study in the work context by default and the rest in personal", () => {
    expect(domainContext(b, "work")).toBe("work");
    expect(domainContext(b, "study")).toBe("work");
    expect(domainContext(b, "health")).toBe("personal");
    expect(domainContext({ ...b, workDomains: ["work"] }, "study")).toBe("personal");
  });

  it("lists the contexts an agent acts in", () => {
    const agent = { id: "x", domain: null, actionDomains: ["work", "family"] } as unknown as AgentDefinition;
    expect(agentContexts(agent, b)).toEqual(["personal", "work"]);
    expect(agentContexts({ ...agent, actionDomains: [] }, b)).toEqual([]);
  });

  it("validates the owner's work domains and bridges", () => {
    expect(validateLifeMap({ ...demoLifeMap, boundaries: { ...b, workDomains: ["work"], contextBridges: ["a"] } })).toEqual([]);
    expect(validateLifeMap({ ...demoLifeMap, boundaries: { ...b, workDomains: ["office"] } } as never)).toContain(
      "boundaries.workDomains contains an unknown domain",
    );
  });
});
