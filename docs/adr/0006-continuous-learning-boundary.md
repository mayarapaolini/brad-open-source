# ADR 0006: Continuous Learning — generic contracts in Brad, storage in the adapter

- **Status:** accepted, Phase 1 only (scope explicitly stops at the Phase-1 boundary; see ADR §Consequences)
- **Date:** 2026-10-27
- **Builds on:** [ADR 0003](0003-inkus-editable-mirror.md) (the same split between what stays in Brad and what an adapter owns), [ADR 0001](0001-deterministic-policy-engine.md) (no LLM involved in a decision that must be trusted)
- **Code:** `packages/domain/src/learning.ts`, `packages/domain/src/verification.ts`, `packages/adapter-inkus/src/learning.ts`, `packages/adapter-inkus/src/types.ts` (`InkusClient.setMyActor`/`recordLearning`/`recallLearnings`), `apps/cli/src/commands.ts` (`learning demo`)
- **Reference:** PRD "Brad Continuous Learning & Verified Agent Execution v0.2" (kept in Inkus, not in this repository — see "Open-source delivery" below for why)

## Context

The product PRD asks for a Continuous Learning Engine: an agent captures a correction, persists it with evidence, recalls it in a later session, applies it, and a verifier objectively checks the result (`pass`/`fail`/`indeterminate` — never "validated because it was saved or recalled"). A first implementation (`story-weaver` PR #130) built this entirely inside Inkus: a dedicated `agent_learnings` table, RLS, and two MCP tools (`record_learning`, `recall_learnings`).

Inkus is one specific, advanced, customized implementation built on Brad — not the other way around. If the learning mechanism's *logic* (what a learning event is, how recall must be scoped, what counts as objective verification) lives only inside `story-weaver`'s edge function, every other adapter Brad might ever grow (a different backend, a different Inkus-like product) would have to reinvent it, and Brad itself could never demonstrate the PRD's cycle offline. That mirrors exactly the reasoning behind ADR-0003 for agent definitions: Inkus already *mirrors* data whose rules live in Brad.

## Decision

**The generic learning mechanism — types, the memory contract, and the verification contract — lives in Brad. Physical storage, RLS and per-actor isolation stay in whichever adapter implements the contract (Inkus today).**

| In `@brad/domain` (generic, provider-agnostic) | In `@brad/adapter-inkus` (storage-specific) |
| --- | --- |
| `LearningEvent` shape, `LearningKind`/`LearningStatus`/`LearningAccessScope`, the `MemoryProvider` contract (`record`/`recall`), `VerificationResult`/`VerificationInterface`, the `syntheticRegressionVerifier` reference implementation | `agent_learnings` table + RLS + ownership trigger (Inkus), `record_learning`/`recall_learnings` MCP tools, `InkusClient.recordLearning`/`recallLearnings`/`setMyActor`, `createInkusMemoryProvider` (translates between the two shapes) |

- **PR #130 is not discarded.** `agent_learnings`, its RLS, and the two MCP tools are exactly the adapter-side implementation this ADR asks for. Nothing there changes; `createInkusMemoryProvider` wraps it as-is.
- **One token, one actor, enforced by Inkus, not by Brad.** Inkus always records/recalls learnings for the actor the calling token is bound to (`set_my_actor`), never one named in the call's own arguments. Brad's adapter must call `setMyActor` once before using `recordLearning`/`recallLearnings`; this was a real, previously-unmet precondition — the existing Brad↔Inkus integration (actor/spec sync) never needed an actor binding, so this is a new, additive requirement on the Inkus connection, not a change to it.
- **Verification is deterministic and local to Brad, never a model grading itself.** `syntheticRegressionVerifier` runs a `before`/`after` fixture and an objective `isCorrect` comparison; a thrown error is `indeterminate`, never `fail` — a broken harness is not evidence the correction doesn't work. This mirrors ADR-0001's "no LLM in a decision that must be trusted."
- **The fact that a verification ran, and its result, is a local `DecisionRecord` in Brad** (`kind: "correction"`, already in the existing enum). The learning event's content stays wherever `MemoryProvider` stored it (Inkus today); Brad's own audit trail records only that a cycle ran and what it found — the same split ADR-0003 uses for "decision history never leaves Brad."
- **No duplicated engine, no circular dependency.** `@brad/adapter-inkus` depends on `@brad/domain` (as it already did); nothing in `@brad/domain` or any other Brad package depends on Inkus or Supabase. `story-weaver` gains no dependency on this repository in Phase 1 — the only coupling is the existing MCP tool surface.
- **The CLI pilot (`pnpm run brad learning demo`) only runs against the synthetic workspace** (`BRAD_INKUS_FAKE=1`); it refuses to run against a real Inkus connection. A pilot against a live workspace, with real credentials and a real agent task, is a separate, explicitly-approved step — not something this command does on its own.

## PRD open decisions (D1–D6)

| # | Decision | Status |
| --- | --- | --- |
| D1 | Where is the real actor-execution runtime? | **Partially resolved — see [ADR 0007](0007-agent-harness.md).** For Inkus, it's whatever external AI client (Claude, ChatGPT, …) follows the generated prompt — there is no runtime inside Inkus itself. For Brad, `packages/harness`'s `runTurn` now provides a real loop (model→policy-gated tool call→result, step-budgeted) with one real local tool (`read_notes`) and `policy-engine.evaluate()` as a real enforcement gate, not just simulation — but no real `ModelAdapter` is wired up yet (a `ScriptedModel` only), and no `ToolExecutor` touches a real external system. The Phase-1 learning pilot still verifies a synthetic fixture, not a live task through this harness; connecting the two is a deliberate next step, not done here. |
| D2 | Does the generic `databases`/`records` system support ACL and efficient filtered queries? | **Resolved: no**, not to the degree per-actor isolation needs. This is exactly why PR #130 used a dedicated table with RLS + an ownership trigger instead of the generic records system — documented there already. |
| D3 | What guarantees does MCP semantic search give on pre-ranking authorization filtering? | **Does not apply in Phase 1.** `recall_learnings` does exact filtering (`actor_id`, `status`, optional `domain`) with no semantic ranking. Stays open for a future consolidator/retriever (Phase 2+). |
| D4 | How do events get stable evidence and retention control? | **Partially resolved.** `evidence` is required and immutable; a newer event supersedes an older one (`supersedesId`) instead of overwriting it. **No retention/expiry exists** — no TTL, no automatic deletion. Real gap, not addressed in Phase 1. |
| D5 | What is the consent mechanism for memory and portability? | **Not resolved — real gap**, on both sides. ADR-0004's per-item consent toggle for life-map sync is the closest precedent and could inform a future design, but nothing equivalent exists yet for learning events. |
| D6 | What plugin contracts and documentation conventions exist in the repository? | **Resolved.** This is exactly the `packages/adapter-*` + `docs/adr/*` convention already used for Inkus/Obsidian/Hermes; Continuous Learning follows the same shape (contract in `domain`, implementation in the adapter, this ADR documenting the boundary). |

## Consequences

- A future adapter (a different backend, a different product) implements `MemoryProvider` and `VerificationInterface` against its own storage, with zero changes to `@brad/domain` or to `story-weaver`.
- Brad can demonstrate the full PRD cycle (record → new session → recall → apply → verify) entirely offline, against `FakeInkus`, with no credentials and no network — exactly what `packages/adapter-inkus/test/learning.test.ts` and `pnpm run brad learning demo` do.
- The richer event shape the PRD describes (organization/project/session scoping beyond a single actor, retention policy, consent) is intentionally **not** built now (D4/D5 above, and Phases 2–4 of the roadmap); `LearningEvent` carries the fields but Inkus does not yet persist most of them, and `@brad/domain` does not pretend otherwise.
- **Open-source delivery:** this ADR, the code, and the tests are the complete public record of this decision. The full PRD (a private product document, with product/business context beyond this ADR's scope) stays in Inkus; nothing personal, corporate, or credential-shaped is referenced here or in the code.

## Alternatives considered

- **Keep everything in `story-weaver`, Brad stays unaware:** rejected — this is precisely the "two independent learning engines" outcome the product decision explicitly ruled out.
- **Move physical storage into Brad now:** rejected for Phase 1 — Inkus' RLS/ownership/isolation already does this correctly and moving it would duplicate infrastructure without a technical need, contradicting "no unnecessary complex infrastructure."
- **A richer `MemoryProvider` surface now (consolidation, dedup by similarity, retention):** deferred to Phase 2+, per the PRD's own non-goals for Phase 1.
