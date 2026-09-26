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
    expect(decision.decidedBy).toBe("default_allow");
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
