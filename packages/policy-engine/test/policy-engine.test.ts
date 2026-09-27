import { describe, expect, it } from "vitest";
import { generateDraftAgents } from "@brad/agent-factory";
import { demoGrants, demoLifeMap, demoNow, type AgentDefinition } from "@brad/domain";
import { evaluate, RULE_ORDER, type PolicyContext } from "../src";

function context(overrides: Partial<PolicyContext> = {}, approve: string[] = []): PolicyContext {
  const agents: AgentDefinition[] = generateDraftAgents(demoLifeMap).map((a) =>
    approve.includes(a.id) ? { ...a, state: "approved" } : a,
  );
  return { agents, grants: demoGrants, boundaries: demoLifeMap.boundaries, now: demoNow, ...overrides };
}

describe("policy engine", () => {
  it("allows a granted, non-consequential action by an approved agent", () => {
    const decision = evaluate(
      { agentId: "agent-family", capability: "draft_reply", domain: "family" },
      context({}, ["agent-family"]),
    );
    expect(decision.outcome).toBe("allow");
    expect(decision.decidedBy).toBe("all_rules_passed");
  });

  it("denies by default when there is no grant", () => {
    const decision = evaluate(
      { agentId: "agent-family", capability: "read_messages", domain: "family" },
      context({}, ["agent-family"]),
    );
    expect(decision).toMatchObject({ outcome: "deny", decidedBy: "grant_present" });
  });

  it("denies draft agents even when a grant exists", () => {
    const decision = evaluate(
      { agentId: "agent-family", capability: "draft_reply", domain: "family" },
      context(),
    );
    expect(decision).toMatchObject({ outcome: "deny", decidedBy: "agent_state" });
  });

  it("denies expired and revoked grants", () => {
    const expired = evaluate(
      { agentId: "agent-work", capability: "read_messages", domain: "work" },
      context({}, ["agent-work"]),
    );
    expect(expired).toMatchObject({ outcome: "deny", decidedBy: "grant_valid" });
    expect(expired.trace.find((s) => s.rule === "grant_valid")?.params.reason).toBe("expired");

    const revoked = evaluate(
      { agentId: "agent-family", capability: "draft_reply", domain: "family" },
      context({ grants: demoGrants.map((g) => ({ ...g, revokedAt: "2026-03-05T10:00:00-03:00" })) }, ["agent-family"]),
    );
    expect(revoked.trace.find((s) => s.rule === "grant_valid")?.params.reason).toBe("revoked");
  });

  it("denies forbidden capabilities regardless of grants", () => {
    const grants = [...demoGrants, { ...demoGrants[0]!, id: "g-pay", agentId: "agent-finances", capability: "make_payment" as const }];
    const decision = evaluate(
      { agentId: "agent-finances", capability: "make_payment", domain: "finances" },
      context({ grants }, ["agent-finances"]),
    );
    expect(decision).toMatchObject({ outcome: "deny", decidedBy: "forbidden_capability" });
  });

  it("denies actions outside the agent's own domain", () => {
    const decision = evaluate(
      { agentId: "agent-family", capability: "draft_reply", domain: "work" },
      context({}, ["agent-family"]),
    );
    expect(decision).toMatchObject({ outcome: "deny", decidedBy: "domain_scope" });
  });

  it("asks for confirmation in sensitive domains", () => {
    const decision = evaluate(
      { agentId: "agent-health", capability: "create_event", domain: "health" },
      context({}, ["agent-health"]),
    );
    expect(decision).toMatchObject({ outcome: "confirm", decidedBy: "sensitive_domain" });
  });

  it("denies unknown agents", () => {
    const decision = evaluate({ agentId: "agent-ghost", capability: "read_notes", domain: "growth" }, context());
    expect(decision).toMatchObject({ outcome: "deny", decidedBy: "agent_known" });
  });

  it("always records every rule in a fixed order", () => {
    const decision = evaluate({ agentId: "agent-ghost", capability: "read_notes", domain: "growth" }, context());
    expect(decision.trace.map((s) => s.rule)).toEqual(RULE_ORDER);
    expect(decision.trace.slice(1).every((s) => s.status === "skipped")).toBe(true);
  });
});

describe("grant selection", () => {
  it("uses a new valid grant even when an older revoked one exists", () => {
    const revoked = { ...demoGrants[0]!, id: "g-old", revokedAt: "2026-03-02T10:00:00-03:00" };
    const fresh = { ...demoGrants[0]!, id: "g-new", issuedAt: "2026-03-05T10:00:00-03:00" };
    const decision = evaluate(
      { agentId: "agent-family", capability: "draft_reply", domain: "family" },
      context({ grants: [revoked, fresh] }, ["agent-family"]),
    );
    expect(decision.outcome).toBe("allow");
    expect(decision.trace.find((s) => s.rule === "grant_present")?.params.grantId).toBe("g-new");
  });
});

describe("cross-cutting agents", () => {
  const orchestrator: AgentDefinition = {
    id: "inkus-orchestrator",
    name: "Orchestrator",
    domain: null,
    state: "approved",
    goal: "Balance priorities",
    reason: "imported",
    requestedCapabilities: ["read_calendar"],
    excludedByBoundary: [],
    escalation: "ask_owner",
    origin: "inkus",
  };
  const grant = { ...demoGrants[0]!, id: "g-orch", agentId: orchestrator.id, capability: "read_calendar" as const };
  const request = { agentId: orchestrator.id, capability: "read_calendar" as const, domain: "work" as const };

  it("are denied everywhere until the owner lists domains for them", () => {
    const decision = evaluate(request, context({ agents: [orchestrator], grants: [grant] }));
    expect(decision).toMatchObject({ outcome: "deny", decidedBy: "domain_scope" });
    expect(decision.trace.find((s) => s.rule === "domain_scope")?.params.agentDomain).toBe("cross_cutting");
  });

  it("may act only in the listed domains", () => {
    const listed = { ...orchestrator, actionDomains: ["work" as const] };
    expect(evaluate(request, context({ agents: [listed], grants: [grant] })).outcome).toBe("allow");
    expect(evaluate({ ...request, domain: "family" }, context({ agents: [listed], grants: [grant] })).outcome).toBe("deny");
  });
});

describe("personal and work contexts", () => {
  const bridgeAgent: AgentDefinition = {
    id: "inkus-orchestrator",
    name: "Orchestrator",
    domain: null,
    actionDomains: ["work", "family"],
    state: "approved",
    goal: "Balance priorities",
    reason: "imported",
    requestedCapabilities: ["read_calendar"],
    excludedByBoundary: [],
    escalation: "ask_owner",
    origin: "inkus",
  };
  const grant = { ...demoGrants[0]!, id: "g-orch", agentId: bridgeAgent.id, capability: "read_calendar" as const };
  const request = { agentId: bridgeAgent.id, capability: "read_calendar" as const, domain: "work" as const };

  it("deny an agent that spans both contexts until the owner allows a bridge", () => {
    const decision = evaluate(request, context({ agents: [bridgeAgent], grants: [grant] }));
    expect(decision).toMatchObject({ outcome: "deny", decidedBy: "context_boundary" });
    expect(decision.trace.find((s) => s.rule === "context_boundary")?.params).toMatchObject({
      agentContext: "personal+work",
      requestContext: "work",
    });
    const base = context({ agents: [bridgeAgent], grants: [grant] });
    const bridged = { ...base, boundaries: { ...base.boundaries, contextBridges: [bridgeAgent.id] } };
    expect(evaluate(request, bridged).outcome).toBe("allow");
  });

  it("follow the owner's own split of work domains", () => {
    const base = context({ agents: [bridgeAgent], grants: [grant] });
    const allWork = { ...base, boundaries: { ...base.boundaries, workDomains: ["work" as const, "family" as const] } };
    expect(evaluate(request, allWork).outcome).toBe("allow");
  });

  it("check the context right after the domain scope", () => {
    expect(RULE_ORDER.indexOf("context_boundary")).toBe(RULE_ORDER.indexOf("domain_scope") + 1);
  });
});
