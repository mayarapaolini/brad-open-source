# ADR 0003: Inkus as an editable mirror of agent definitions

- **Status:** accepted
- **Date:** 2026-09-26
- **Amends:** [ADR 0002](0002-local-first-architecture.md) (Inkus is no longer publish-only)
- **Code:** `packages/adapter-inkus`, `apps/api/src/server.ts` (`/api/adapters/inkus/sync`, `/api/agents/update`)

## Context

The owner keeps agent definitions in Inkus, a workspace with versioned agent specifications (`draft` / `active` / `deprecated`). Hermes runs agents by reading their active specification from Inkus. The owner wants to edit agents both in Brad Studio and in Inkus, and to bring the agents that already exist in Inkus into Brad. Some of those agents do not belong to a single life domain, such as an orchestrator or a privacy guardian.

ADR 0002 made the local store the source of truth and treated Inkus as a publish-only target. That no longer fits how the owner works.

## Decision

**Inkus becomes an editable mirror of agent *definitions*. Everything that authorizes action stays in Brad.**

| Synced both ways | Never leaves Brad, never taken from Inkus |
| --- | --- |
| name, mission/goal, responsibilities, domain, allowed domains for cross-cutting agents, requested capabilities | lifecycle state as an input, grants, decision history, life map, people, boundaries |

- **Explicit sync.** A sync runs only when the owner asks, through the button or `POST /api/adapters/inkus/sync`. There is no background polling, in line with "no silent ingestion".
- **Pull first.** Each `ai` actor's active spec is compared with the version Brad last saw. A newer version is **applied directly** (owner decision): content is replaced and state is kept. If the same agent was also edited in Brad since the last sync, **Inkus wins**, and the replaced fields are listed in the sync record. They are never dropped silently.
- **Push second.** Local edits create a new spec version in Inkus, which is then activated. Inkus never overwrites versions, so history is kept on both sides. Brad agents Inkus has not seen yet become new `ai` actors. Inkus fields Brad does not model (prompt, model, temperature, knowledge domains…) are carried through unchanged.
- **Brad's data lives in its own namespace.** Brad reads and writes only `capabilities.brad` (`requested`, `domain`, `actionDomains`, `state`), and ignores other keys when deciding what an agent may do. An agent without that namespace requests nothing.
- **Safety invariants that hold whatever Inkus says:**
  - An imported agent starts as a `draft` with no grants.
  - An Inkus edit can make an agent *request* a capability, but never *grants* it. Capabilities the owner forbids are dropped.
  - When a capability is no longer requested, its grant is revoked.
  - An Inkus change never moves an agent's lifecycle state (for example, it cannot activate an agent).
  - A cross-cutting agent (`domain: null`) is denied in every domain until the owner lists `actionDomains` for it. The policy engine's `domain_scope` rule enforces this ([ADR 0001](0001-deterministic-policy-engine.md)).
- **Connection.** Brad is an MCP client of Inkus over streamable HTTP. The adapter is off unless `BRAD_ADAPTER_INKUS_ENABLED=true`. `BRAD_INKUS_MCP_URL` and `BRAD_INKUS_TOKEN` come from the environment (or a keychain wrapper) and are never stored in the repository or the database.
- **Hermes** reads the active spec from Inkus, so it follows Brad's edits after each sync, with no separate integration.

## Consequences

- The owner can edit an agent in either place, and the next sync reconciles it with a visible report.
- Pushing sends agent definitions, including goal text, to Inkus. That is the owner's explicit choice; people, grants and history are never sent.
- **Open item: Hermes and policy.** Hermes executes from Inkus but cannot yet ask Brad's policy engine for a decision, because the Brad API is localhost-only. Until a decision channel exists, Hermes must treat `capabilities.brad.requested` as an upper bound and respect `default_access: deny` / `external_writes: approval_required`. This is tracked as a roadmap issue.
- Tests use an in-memory Inkus (`FakeInkus`) seeded with synthetic agents. The same fake powers the offline demo (`BRAD_INKUS_FAKE=1`). The real Inkus connection is verified manually, never with committed personal data.

## Alternatives considered

- **Review queue for Inkus edits:** safer against surprise changes, but the owner chose direct application. The invariants above keep that safe, because edits cannot grant or activate.
- **Last-write-wins by timestamp:** rejected, because it drops edits silently.
- **Inkus as the only source of agent definitions:** rejected, because Brad must keep working offline with no account.
