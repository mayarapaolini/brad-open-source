import { describe, expect, it } from "vitest";
import {
  checkTransition,
  demoGrants,
  demoLifeMap,
  demoNow,
  validateExport,
  type AgentDefinition,
  type BradExport,
} from "../src";

const agent: AgentDefinition = {
  id: "agent-family",
  domain: "family",
  state: "draft",
  goal: "Be present",
  reason: "importance",
  requestedCapabilities: ["draft_reply"],
  excludedByBoundary: [],
  escalation: "ask_owner",
};
const ctx = { grants: demoGrants, hasSimulation: true, now: demoNow };

describe("checkTransition", () => {
  it("only allows listed transitions", () => {
    expect(checkTransition(agent, "configured", ctx)).toEqual({ ok: true });
    expect(checkTransition(agent, "active", ctx)).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(checkTransition({ ...agent, state: "archived" }, "draft", ctx)).toMatchObject({ reason: "not_allowed" });
  });

  it("requires a goal and capabilities before configuring", () => {
    expect(checkTransition({ ...agent, goal: " " }, "configured", ctx)).toMatchObject({ reason: "missing_goal" });
    expect(checkTransition({ ...agent, requestedCapabilities: [] }, "configured", ctx)).toMatchObject({
      reason: "no_capabilities",
    });
  });

  it("requires a policy simulation before simulated/approved", () => {
    const configured = { ...agent, state: "configured" as const };
    expect(checkTransition(configured, "simulated", { ...ctx, hasSimulation: false })).toMatchObject({
      reason: "not_simulated",
    });
    expect(checkTransition(configured, "simulated", ctx)).toEqual({ ok: true });
  });

  it("requires a currently valid grant to activate", () => {
    const approved = { ...agent, state: "approved" as const };
    expect(checkTransition(approved, "active", ctx)).toEqual({ ok: true });
    const revoked = demoGrants.map((g) => ({ ...g, revokedAt: demoNow }));
    expect(checkTransition(approved, "active", { ...ctx, grants: revoked })).toMatchObject({ reason: "no_valid_grant" });
  });

  it("always allows pausing and archiving an active agent", () => {
    const active = { ...agent, state: "active" as const, goal: "" };
    expect(checkTransition(active, "paused", { ...ctx, grants: [] })).toEqual({ ok: true });
    expect(checkTransition(active, "archived", { ...ctx, grants: [] })).toEqual({ ok: true });
  });
});

describe("validateExport", () => {
  const good: BradExport = {
    format: "brad-export",
    version: 1,
    exportedAt: demoNow,
    lifeMap: demoLifeMap,
    agents: [agent],
    grants: [demoGrants[0]!],
  };

  it("accepts a well-formed export", () => {
    expect(validateExport(good)).toEqual([]);
  });

  it("rejects other formats, bad agents and orphan grants", () => {
    expect(validateExport({ ...good, format: "other" })).toEqual(['format must be "brad-export"']);
    expect(validateExport({ ...good, agents: [{ ...agent, state: "rogue" }] })).toEqual(["agents[0].state is unknown"]);
    expect(validateExport({ ...good, grants: [{ ...demoGrants[0]!, agentId: "agent-ghost" }] })).toEqual([
      "grants[0].agentId does not match any agent",
    ]);
  });
});
