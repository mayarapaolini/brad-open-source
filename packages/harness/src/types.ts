import type { AgentDefinition, Capability, LearningEvent } from "@brad/domain";

/**
 * Contracts for a minimal agent-execution harness (ADR-0007). The model itself is never part
 * of this package — `ModelAdapter` is the only seam a real provider plugs into, so this package
 * never depends on an LLM SDK, an API key, or any specific vendor (same invariant the README
 * already states for the framework as a whole).
 */

export interface ToolCall {
  /** Opaque id the model adapter assigns, echoed back in the tool result. */
  id: string;
  capability: Capability;
  /** Free-form arguments for the capability; the matching ToolExecutor interprets them. */
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  ok: boolean;
  /** Human/model-readable outcome — what happened, or why it didn't. */
  output: string;
}

/** What the harness gives the model before asking it to respond. */
export interface TurnContext {
  agent: AgentDefinition;
  goal: string;
  /** Learnings recalled for this agent before composing the prompt (PRD: recall must feed a
   *  real execution flow, not sit behind an unused endpoint). */
  learnings: LearningEvent[];
  /** Prior steps in this same run, oldest first. */
  history: { toolCall: ToolCall; result: ToolResult }[];
}

export interface ModelTurn {
  /** Set when the model is done and has a final answer; absent while it still wants tool calls. */
  text: string | null;
  toolCalls: ToolCall[];
}

/** The only seam a real model provider plugs into. Never implemented against a live LLM here. */
export interface ModelAdapter {
  next(context: TurnContext): Promise<ModelTurn>;
}

/** One per `Capability` the harness can actually carry out. */
export interface ToolExecutor {
  capability: Capability;
  execute(call: ToolCall, agent: AgentDefinition): Promise<ToolResult>;
}

export type ApprovalOutcome = "allow" | "deny" | "unavailable";

/**
 * Asks for a real decision on a `confirm` policy outcome. Fail-closed: anything other than an
 * explicit "allow" (a deny, a timeout, no broker configured) must be treated as refused.
 */
export interface ApprovalBroker {
  request(call: ToolCall, reason: string): Promise<ApprovalOutcome>;
}

export type RunStepOutcome =
  | { kind: "executed"; policy: "allow"; result: ToolResult }
  | { kind: "refused"; policy: "deny"; reason: string }
  | { kind: "approved"; policy: "confirm"; result: ToolResult }
  | { kind: "refused"; policy: "confirm"; reason: string };

export interface RunStep {
  toolCall: ToolCall;
  outcome: RunStepOutcome;
}

export type RunStatus = "completed" | "budget_exceeded";

export interface RunResult {
  agentId: string;
  goal: string;
  steps: RunStep[];
  finalText: string | null;
  status: RunStatus;
}
