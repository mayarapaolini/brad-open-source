import { describe, expect, it } from "vitest";
import { generateDraftAgents } from "@brad/agent-factory";
import { demoGrants, demoLifeMap, demoNow, type AgentDefinition } from "@brad/domain";
import { FixedApprovalBroker, ScriptedModel, echoTool, runTurn } from "../src";
import type { ModelTurn } from "../src";

function agents(approve: string[] = []): AgentDefinition[] {
  return generateDraftAgents(demoLifeMap).map((a) => (approve.includes(a.id) ? { ...a, state: "approved" } : a));
}

const policy = { grants: demoGrants, boundaries: demoLifeMap.boundaries };
const now = () => demoNow;

describe("runTurn", () => {
  it("executes an allowed tool call and finishes with the model's final text", async () => {
    const script: ModelTurn[] = [
      { text: null, toolCalls: [{ id: "c1", capability: "draft_reply", input: { to: "sister" } }] },
      { text: "Drafted a reply.", toolCalls: [] },
    ];
    const result = await runTurn({
      agent: agents(["agent-family"]).find((a) => a.id === "agent-family")!,
      goal: "Reply to my sister",
      domain: "family",
      model: new ScriptedModel(script),
      tools: [echoTool("draft_reply")],
      approvals: new FixedApprovalBroker("unavailable"),
      policy: { ...policy, agents: agents(["agent-family"]) },
      now,
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Drafted a reply.");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.outcome).toMatchObject({ kind: "executed", policy: "allow" });
    expect((result.steps[0]!.outcome as { result: { output: string } }).result.output).toContain("draft_reply");
  });

  it("refuses a denied tool call without executing it, and still lets the model respond", async () => {
    const script: ModelTurn[] = [
      { text: null, toolCalls: [{ id: "c1", capability: "read_messages", input: {} }] },
      { text: "Couldn't read messages, so I'll ask first.", toolCalls: [] },
    ];
    let executed = false;
    const result = await runTurn({
      agent: agents(["agent-family"]).find((a) => a.id === "agent-family")!,
      goal: "Check messages",
      domain: "family",
      model: new ScriptedModel(script),
      tools: [{ capability: "read_messages", async execute(call) { executed = true; return { id: call.id, ok: true, output: "x" }; } }],
      approvals: new FixedApprovalBroker("unavailable"),
      policy: { ...policy, agents: agents(["agent-family"]) },
      now,
    });
    expect(result.status).toBe("completed");
    expect(executed).toBe(false);
    expect(result.steps[0]!.outcome).toMatchObject({ kind: "refused", policy: "deny" });
  });

  it("executes a confirm-gated tool call only after the approval broker allows it", async () => {
    const script: ModelTurn[] = [
      { text: null, toolCalls: [{ id: "c1", capability: "create_event", input: { title: "checkup" } }] },
      { text: "Scheduled the checkup.", toolCalls: [] },
    ];
    const result = await runTurn({
      agent: agents(["agent-health"]).find((a) => a.id === "agent-health")!,
      goal: "Book a health checkup",
      domain: "health",
      model: new ScriptedModel(script),
      tools: [echoTool("create_event")],
      approvals: new FixedApprovalBroker("allow"),
      policy: { ...policy, agents: agents(["agent-health"]) },
      now,
    });
    expect(result.steps[0]!.outcome).toMatchObject({ kind: "approved", policy: "confirm" });
    expect(result.finalText).toBe("Scheduled the checkup.");
  });

  it("fails closed when the approval broker is unavailable or denies (confirm never executes)", async () => {
    for (const outcome of ["deny", "unavailable"] as const) {
      let executed = false;
      const script: ModelTurn[] = [
        { text: null, toolCalls: [{ id: "c1", capability: "create_event", input: {} }] },
        { text: "Could not schedule it.", toolCalls: [] },
      ];
      const result = await runTurn({
        agent: agents(["agent-health"]).find((a) => a.id === "agent-health")!,
        goal: "Book a health checkup",
        domain: "health",
        model: new ScriptedModel(script),
        tools: [{ capability: "create_event", async execute(call) { executed = true; return { id: call.id, ok: true, output: "x" }; } }],
        approvals: new FixedApprovalBroker(outcome),
        policy: { ...policy, agents: agents(["agent-health"]) },
        now,
      });
      expect(executed).toBe(false);
      expect(result.steps[0]!.outcome).toMatchObject({ kind: "refused", policy: "confirm" });
    }
  });

  it("stops at the step budget instead of looping forever on a model that never finishes", async () => {
    const looping = { async next() { return { text: null, toolCalls: [{ id: "c", capability: "read_notes" as const, input: {} }] }; } };
    const result = await runTurn({
      agent: agents(["agent-family"]).find((a) => a.id === "agent-family")!,
      goal: "Never stop",
      domain: "family",
      model: looping,
      tools: [echoTool("read_notes")],
      approvals: new FixedApprovalBroker("unavailable"),
      policy: { ...policy, agents: agents(["agent-family"]) },
      maxSteps: 3,
      now,
    });
    expect(result.status).toBe("budget_exceeded");
    expect(result.finalText).toBeNull();
    expect(result.steps).toHaveLength(3);
  });

  it("passes recalled learnings through to the model's context", async () => {
    const seen: unknown[] = [];
    const model = {
      async next(context: { learnings: unknown[] }) {
        seen.push(context.learnings);
        return { text: "ok", toolCalls: [] };
      },
    };
    const learning = {
      id: "l1",
      schemaVersion: 1 as const,
      actorId: "a1",
      domain: "family" as const,
      kind: "correction" as const,
      content: "Always greet by name",
      evidence: "e",
      observedAt: now(),
      accessScope: "actor" as const,
      status: "active" as const,
    };
    await runTurn({
      agent: agents(["agent-family"]).find((a) => a.id === "agent-family")!,
      goal: "Greet them",
      domain: "family",
      model,
      tools: [],
      approvals: new FixedApprovalBroker("unavailable"),
      policy: { ...policy, agents: agents(["agent-family"]) },
      learnings: [learning],
      now,
    });
    expect(seen[0]).toEqual([learning]);
  });
});
