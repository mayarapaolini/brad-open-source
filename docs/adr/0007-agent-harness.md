# ADR 0007: A minimal agent-execution harness, with policy as the only real gate

- **Status:** accepted, Phase 1 only — no real model provider, no Studio UI, no real external
  tool executors beyond one local, safe capability (see "Consequences")
- **Date:** 2026-10-31
- **Builds on:** [ADR 0001](0001-deterministic-policy-engine.md) (the policy engine decides,
  never a model), [ADR 0006](0006-continuous-learning-boundary.md) (D1: "no real
  agent-execution runtime exists yet")
- **Code:** `packages/harness` (`ModelAdapter`, `ToolExecutor`, `ApprovalBroker`, `runTurn`),
  `apps/cli/src/commands.ts` (`brad run`)

## Context

"Harness" is the layer around a model that makes it do real work: it assembles context, gives
the model tools, runs the call→tool→result loop, enforces permissions, and manages session
state. Brad had none of this. Confirmed by reading the code, not assuming it: zero LLM SDK
imports anywhere in the repository; `policy-engine`'s `evaluate()` was called exactly once, as a
`POST /api/simulate/policy` what-if for the Studio's "Simulation" step, never to gate a real
action; every agent-related package (`agent-factory`, `domain`, `priority-engine`, `secretary`)
produces or ranks **data** — drafts, proposals, scores — never executes anything; and there was
no session/turn/task concept anywhere, only a flat, one-shot `DecisionRecord` log.

This is exactly D1 from ADR-0006. Closing it is what would let a future real pilot move past a
synthetic regression fixture to actually running a task.

## Decision

**A new, small `packages/harness` package adds the loop. It decides nothing — `policy-engine`
still does, exactly as ADR-0001 requires for every other action in this codebase.**

- **`ModelAdapter`** is the only seam a model plugs into: `next(context) → { text, toolCalls }`.
  This package has zero LLM SDK dependency and zero API key — a real provider is a separate,
  explicitly later step, not something this ADR ships. Tests and the CLI pilot use a
  `ScriptedModel` that replays a fixed script, the same "fake implementation of the contract"
  pattern `FakeInkus` already established for `adapter-inkus`.
- **The model only *proposes* a tool call. `runTurn` sends every single one through
  `policy-engine.evaluate()` before anything happens** — `allow` executes it via the matching
  `ToolExecutor`, `deny` refuses and tells the model why (never silently drops it), `confirm`
  goes through an `ApprovalBroker` first. This is the one architecturally significant move in
  this ADR: it turns `evaluate()` from a simulation sandbox into the actual enforcement boundary.
- **`ApprovalBroker` fails closed**, mirroring the `RequestOutcome` vocabulary of prior art
  reviewed for this decision (an external open-source agent harness's permission-card flow,
  not copied, only the "unavailable → deny" shape borrowed): anything other than an explicit
  `"allow"` — a deny, a timeout, no broker configured — is refused.
- **A hard step budget** (`maxSteps`, default 8 model round-trips) stops a confused or looping
  model; the run ends with `status: "budget_exceeded"` rather than running forever. This was an
  explicit requirement carried over from the product's own continuous-learning planning
  ("resistência a loops infinitos").
- **No new table, no session object.** A whole run — every step, the final text, the status —
  is written as a single new `DecisionRecord` kind, `"run"` (added to the existing `kind` union
  in `@brad/domain`), reusing the flat decision log exactly as it already works for every other
  kind. `apps/studio`'s Audit view renders it like any other record.
- **Context assembly recalls real learnings, when available.** `runTurn` accepts recalled
  `LearningEvent[]` and threads them into the model's context — the caller recalls them (via
  `createInkusMemoryProvider`, from the Continuous Learning work in ADR-0006) before calling
  `runTurn`; the harness package itself never depends on Inkus or any `MemoryProvider`
  directly, keeping the same storage-agnostic boundary ADR-0006 already established.
- **`brad run <agentId> "<goal>" [--domain <domain>]`** is the one entry point, in the CLI, same
  pattern as `brad learning demo` — no new Studio UI this phase. It wires `runTurn` against a
  real local `Store` (agents, grants, boundaries) and exactly one real `ToolExecutor`:
  `read_notes`, reading the agent's own life-map note — local, safe, nothing external touched.

## Consequences

- **D1 is partially resolved**, not closed. The harness loop, the real policy gate, and one real
  local tool now exist and are tested end to end. What's still missing for D1 to be fully
  resolved: a real `ModelAdapter` (no provider is wired up), and real `ToolExecutor`s for
  anything beyond `read_notes` — `send_message`/`make_payment`/`delete_item`/`create_event`
  still have no executor that touches a real external system. Approving a `confirm` request in
  this phase unblocks the loop and records the intent; it does not send, schedule, or pay
  anything, preserving the invariant already stated elsewhere in this codebase ("Accepting only
  records the owner's choice. Nothing is sent, scheduled or paid.").
- A future real `ModelAdapter` and real external `ToolExecutor`s are additive: nothing in
  `runTurn`'s contract needs to change, only new implementations of `ModelAdapter`/
  `ToolExecutor` need to be written and wired in, same shape as swapping `FakeInkus` for
  `connectInkus` already works today.
- `policy-engine` keeps its `evaluate()` signature untouched; this ADR is purely a new consumer
  of it, not a change to its rules or behavior.

## Alternatives considered

- **Build the approval UI in Studio now:** rejected for this phase — no chat/run console exists
  there yet, and building one is a separate, larger scope than closing D1 needs.
- **Wire a real LLM provider immediately:** rejected — introduces a secret, a cost, and a vendor
  dependency this framework explicitly avoids requiring; a real `ModelAdapter` is a deliberate
  later step.
- **Let the model's own confidence decide `allow`/`deny`:** rejected outright — this is precisely
  what ADR-0001 already rules out for every other decision in this codebase.
