import type { ApprovalBroker, ApprovalOutcome, ModelAdapter, ModelTurn, ToolCall, ToolExecutor, ToolResult } from "./types";

/**
 * Deterministic model for tests and the CLI demo — never a real LLM (no package in this repo
 * calls one; see ADR-0007). Replays a fixed script of turns, one per call to `next()`,
 * regardless of context; a real `ModelAdapter` would read `context` instead.
 */
export class ScriptedModel implements ModelAdapter {
  private calls = 0;
  constructor(private readonly script: ModelTurn[]) {}

  async next(): Promise<ModelTurn> {
    const turn = this.script[this.calls] ?? { text: null, toolCalls: [] };
    this.calls += 1;
    return turn;
  }
}

/** Always resolves every approval request the same way — for tests. */
export class FixedApprovalBroker implements ApprovalBroker {
  constructor(private readonly outcome: ApprovalOutcome) {}
  async request(): Promise<ApprovalOutcome> {
    return this.outcome;
  }
}

/** Resolves approvals by capability, falling back to "unavailable" (fail-closed) for any other. */
export class ScriptedApprovalBroker implements ApprovalBroker {
  constructor(private readonly byCapability: Partial<Record<ToolCall["capability"], ApprovalOutcome>>) {}
  async request(call: ToolCall): Promise<ApprovalOutcome> {
    return this.byCapability[call.capability] ?? "unavailable";
  }
}

/** A tool executor that always succeeds, echoing its input back — for tests. */
export function echoTool(capability: ToolCall["capability"]): ToolExecutor {
  return {
    capability,
    async execute(call): Promise<ToolResult> {
      return { id: call.id, ok: true, output: `executed ${capability}: ${JSON.stringify(call.input)}` };
    },
  };
}
