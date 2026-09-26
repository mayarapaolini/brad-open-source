import { describe, expect, it } from "vitest";
import { datedAssessments, demoExportUtc, demoLifeMap, planImport, withTimeZone, type AgentDefinition } from "../src";

const agent: AgentDefinition = {
  id: "agent-family",
  domain: "family",
  state: "active",
  goal: "Be present",
  reason: "importance",
  requestedCapabilities: [],
  excludedByBoundary: [],
  escalation: "ask_owner",
};

describe("planImport", () => {
  it("flags a UTC time zone, active agents and replacement of local data", () => {
    const plan = planImport({ lifeMap: demoLifeMap, agents: [], grants: [] }, demoExportUtc([agent]));
    expect(plan.identical).toBe(false);
    expect(plan.timeZone).toEqual({ from: "America/Sao_Paulo", to: "UTC" });
    expect(plan.warnings.map((w) => w.code)).toEqual(["timezone_utc", "active_agents_paused", "replaces_local_data"]);
    expect(plan.agents.added).toEqual(["agent-family"]);
    expect(plan.boundariesChanged).toBe(true);
    expect(plan.assessments).toEqual([]);
  });

  it("lists changed assessments and people", () => {
    const incoming = demoExportUtc();
    incoming.lifeMap = structuredClone(incoming.lifeMap);
    incoming.lifeMap.assessments[0]!.satisfaction = 9;
    incoming.lifeMap.people = incoming.lifeMap.people.filter((p) => p.id !== "p-riley");
    const plan = planImport({ lifeMap: demoLifeMap, agents: [], grants: [] }, incoming);
    expect(plan.assessments).toEqual([
      {
        domain: "family",
        before: { satisfaction: 5, importance: 10, goal: "Be present for dinner and school events" },
        after: { satisfaction: 9, importance: 10, goal: "Be present for dinner and school events" },
      },
    ]);
    expect(plan.people.removed).toEqual(["p-riley"]);
  });

  it("recognises an identical import", () => {
    const incoming = demoExportUtc([agent]);
    const plan = planImport({ lifeMap: incoming.lifeMap, agents: [agent], grants: [] }, incoming);
    expect(plan.identical).toBe(true);
    expect(plan.warnings.map((w) => w.code)).not.toContain("replaces_local_data");
  });

  it("treats an empty store as a first import", () => {
    const plan = planImport({ lifeMap: null, agents: [], grants: [] }, demoExportUtc());
    expect(plan.timeZone.from).toBeNull();
    expect(plan.assessments).toHaveLength(10);
    expect(plan.warnings.map((w) => w.code)).toEqual(["timezone_utc"]);
  });
});

describe("helpers", () => {
  it("changes the time zone but keeps quiet hours as local times", () => {
    const map = withTimeZone(demoExportUtc().lifeMap, "America/Sao_Paulo");
    expect(map.boundaries).toMatchObject({ timeZone: "America/Sao_Paulo", quietHours: { start: "19:00", end: "10:00" } });
  });

  it("dates undated assessments without overwriting existing dates", () => {
    const map = structuredClone(demoLifeMap);
    map.assessments[0]!.asOf = "2026-01-01T00:00:00Z";
    const dated = datedAssessments(map, "2026-09-26T12:00:00Z");
    expect(dated.assessments[0]).toMatchObject({ asOf: "2026-01-01T00:00:00Z", source: "self_reported" });
    expect(dated.assessments[1]).toMatchObject({ asOf: "2026-09-26T12:00:00Z", source: "self_reported" });
  });
});
