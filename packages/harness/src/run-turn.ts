import type { AgentDefinition, Boundaries, ConsentGrant, LearningEvent, LifeDomainId } from "@brad/domain";
import { evaluate, type PolicyContext } from "@brad/policy-engine";
import type { ApprovalBroker, ModelAdapter, RunResult, RunStep, ToolCall, ToolExecutor, ToolResult, TurnContext } from "./types";

export interface RunTurnOptions {
  agent: AgentDefinition;
  goal: string;
  /** The domain this run acts in — the agent's own domain for a domain-scoped agent, or one of
   *  its `actionDomains` for a cross-cutting agent. Required explicitly so a cross-cutting
   *  agent never silently defaults into a domain the owner never listed. */
  domain: LifeDomainId;
  model: ModelAdapter;
  tools: ToolExecutor[];
  approvals: ApprovalBroker;
  policy: { agents: AgentDefinition[]; grants: ConsentGrant[]; boundaries: Boundaries };
  /** Learnings recalled once, before the first model call (PRD: recall feeding a real execution
   *  flow, not an unused endpoint). The caller recalls them (e.g. via `createInkusMemoryProvider`)
   *  before calling `runTurn` — this package never depends on a `MemoryProvider` directly, so it
   *  stays storage-agnostic. Omit or pass `[]` when no memory is wired up for this run. */
  learnings?: LearningEvent[];
  /** Hard ceiling on model round-trips, so a confused model can never loop forever. */
  maxSteps?: number;
  now?: () => string;
}

const DEFAULT_MAX_STEPS = 8;

function toolFor(tools: ToolExecutor[], call: ToolCall): ToolExecutor | undefined {
  return tools.find((t) => t.capability === call.capability);
}

/**
 * The harness loop (ADR-0007): assemble context, ask the model for the next step, gate every
 * tool call through the deterministic policy engine (never the model itself), execute or ask
 * for approval accordingly, feed the result back, repeat until the model is done or the step
 * budget runs out. The model only ever *proposes* a tool call — `policy-engine.evaluate()` is
 * the one and only thing that decides whether it happens, exactly as ADR-0001 already requires
 * for every other action in this codebase.
 */
export async function runTurn(options: RunTurnOptions): Promise<RunResult> {
  const { agent, goal, domain, model, tools, approvals, policy, maxSteps = DEFAULT_MAX_STEPS } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const learnings = options.learnings ?? [];
  const history: TurnContext["history"] = [];
  const steps: RunStep[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const turn = await model.next({ agent, goal, learnings, history });
    if (turn.toolCalls.length === 0) {
      return { agentId: agent.id, goal, steps, finalText: turn.text, status: "completed" };
    }

    for (const call of turn.toolCalls) {
      const decision = evaluate(
        { agentId: agent.id, capability: call.capability, domain },
        { ...policy, now: now() } satisfies PolicyContext,
      );

      if (decision.outcome === "deny") {
        const reason = `denied by policy (${decision.decidedBy})`;
        steps.push({ toolCall: call, outcome: { kind: "refused", policy: "deny", reason } });
        history.push({ toolCall: call, result: { id: call.id, ok: false, output: reason } });
        continue;
      }

      if (decision.outcome === "confirm") {
        const reason = `requires confirmation (${decision.decidedBy})`;
        const approval = await approvals.request(call, reason);
        if (approval !== "allow") {
          const refusal = approval === "deny" ? "confirmation denied" : "confirmation unavailable (fail-closed)";
          steps.push({ toolCall: call, outcome: { kind: "refused", policy: "confirm", reason: refusal } });
          history.push({ toolCall: call, result: { id: call.id, ok: false, output: refusal } });
          continue;
        }
        const executor = toolFor(tools, call);
        const result: ToolResult = executor
          ? await executor.execute(call, agent)
          : { id: call.id, ok: false, output: `no executor registered for ${call.capability}` };
        steps.push({ toolCall: call, outcome: { kind: "approved", policy: "confirm", result } });
        history.push({ toolCall: call, result });
        continue;
      }

      // decision.outcome === "allow"
      const executor = toolFor(tools, call);
      const result: ToolResult = executor
        ? await executor.execute(call, agent)
        : { id: call.id, ok: false, output: `no executor registered for ${call.capability}` };
      steps.push({ toolCall: call, outcome: { kind: "executed", policy: "allow", result } });
      history.push({ toolCall: call, result });
    }
  }

  return { agentId: agent.id, goal, steps, finalText: null, status: "budget_exceeded" };
}
