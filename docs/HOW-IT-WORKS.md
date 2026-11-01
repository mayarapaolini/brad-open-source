# How Brad works

Brad is a local-first control plane. It turns your priorities, relationships and constraints into a set of AI agents that you can read, edit and switch off. Each agent starts with no permissions, and every action it might take is checked by rules you can inspect before it runs.

This page is a plain-language tour. For the current status of each feature, see the table in the [README](../README.md#works-today--in-development--planned). For the technical boundaries, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Why it exists

Most agent apps are good at running agents: chatting, using tools, picking a model, scheduling tasks. They are weaker at continuity. The rules for each agent, what it may do on its own, what context it can see and what you already decided tend to live inside one app. Switch apps or models, and that setup is lost or has to be rebuilt by hand.

Brad keeps that layer separate from the runtime that executes the agents, so the setup is meant to survive a change of tool.

## The core flow

1. **Reflect.** You rate each life area for satisfaction and importance. The Wheel of Life is a discovery step. It is not a medical or psychological assessment.
2. **Map.** Brad builds an editable life map: goals, the people who matter, and boundaries.
3. **Propose.** Brad drafts one agent for each area that matters a lot or is neglected. Drafts have no permissions.
4. **Decide.** You adjust goals, people, boundaries and permissions. Permissions are granted for a limited time and can be revoked at any time.
5. **Explain.** A simulation shows why each item was ranked the way it was. Each score is a sum of named rules.
6. **Enable.** You turn on only the adapters you want.
7. **Check.** Every external action goes through the policy engine and is recorded in the local audit history.

## What Brad does not do

- It does not run a chat or act as an agent runtime itself.
- It does not require a cloud service. The MVP runs on your machine, with no LLM in its decision path.
- It does not send, schedule, delete or pay for anything without your confirmation.

## The parts

| Area | Responsibility |
| --- | --- |
| `apps/studio` | Local UI: onboarding, Wheel of Life, life map, agents, permissions, simulation, audit |
| `apps/api` | Localhost-only API boundary |
| `apps/cli` | Import, export, validation, migrations, diagnostics |
| `packages/domain` | Life domains, people, priorities, goals, boundaries, agents |
| `packages/policy-engine` | Consent, authorization, risk gates, confirmations |
| `packages/priority-engine` | Explainable ranking of messages, tasks and calendar events |
| `packages/agent-factory` | Converts the life map into editable draft agents |
| `packages/adapter-sdk` | Capability-based contract for external systems |
| `packages/adapter-*` | Inkus integration today; Obsidian and Hermes are planned |

## Where your data lives

- **Local store (canonical).** Brad's data is kept in a local SQLite database (`.brad/brad.db`). Encryption at rest is planned, not built yet.
- **Projections, not copies.** Integrations receive only what they need for a stated purpose, with a scope, an expiry and a record of where it came from. A conflict never silently overwrites your local choices.
- **Inkus (optional).** Inkus can hold editable mirrors of agent definitions. Changes you make in Brad reach Inkus as drafts that you activate. Grants, lifecycle state, people and history never leave Brad. See [ADR 0003](adr/0003-inkus-editable-mirror.md). The interview can also be read from an Inkus catalog ([ADR 0005](adr/0005-inkus-interview-source.md)). The Inkus sync is tested against a synthetic Inkus; verification against a real workspace is pending.
- **Hermes (planned).** The planned execution adapter runs only active agent specifications from Inkus. Letting it ask Brad's policy engine for decisions is still open; until that exists, it must treat Brad's requested capabilities as an upper bound.
- **Obsidian (planned).** A Markdown copy for local reading.

## Your agents are yours

**Roadmap:** Brad is being designed so that you can use the same agents with any provider or runtime, including several at once, without losing your settings. The goal is that they live in an open document that you own, in the docs repository you choose, and are reapplied on each runtime.

> **Roadmap, not shipped yet.** The parts of this section marked *Roadmap* are not in the code today. Running the same agents on several runtimes at the same time has not been built or tested.

**Today**

- You can export your life map, agents and grants as JSON, and import them again. An import is previewed first and can be undone. Exports never include credentials ([README](../README.md#cli)).
- Inkus is an implemented integration: agent definitions can be kept there as editable drafts ([ADR 0003](adr/0003-inkus-editable-mirror.md)). It is the only knowledge adapter that exists.

**Roadmap**

- Obsidian as a file adapter ([ROADMAP](ROADMAP.md), Milestone 4). Not built yet.
- Hermes as the execution adapter ([ROADMAP](ROADMAP.md), Milestone 4). Not built yet, and no runtime provider interface exists in the code.
- Agents stored in an open, readable format (Markdown with YAML or JSON, validated against a JSON Schema), with a version and history for each agent.
- You choose where agents are stored: a local folder, Git, Google Drive, Notion, Obsidian, Inkus or another repository, through a planned knowledge provider. None is required, and Inkus is one option among them.
- The same agent document runs on any executor through a planned runtime provider.
- Export and import of agents in an open format at any time, without lock-in. Secrets are never included.

This is a design direction, not a claim about any specific vendor. Brad is not affiliated with any model, runtime or tool provider.

## Agent lifecycle

An agent moves through these states:

`draft` → `configured` → `simulated` → `approved` → `active` → `paused` → `archived`

A draft has no permissions and cannot act. An agent cannot become active until its purpose, inputs, permissions, escalation behaviour, retention and an owner-visible explanation are defined. Lifecycle and permission changes are recorded in the local audit history. Brad also keeps earlier versions of your life map and answers, so you can restore them.

## Safety and privacy

- **Deny by default.** The policy engine checks rules in a fixed order, and the first rule that fails decides the result. The engine is deterministic and does not use a language model, so the same input gives the same answer ([ADR 0001](adr/0001-deterministic-policy-engine.md)).
- **Confirmation for consequential actions.** Sending, scheduling, deleting and paying always ask first.
- **Untrusted content.** Connector content is treated as untrusted data. It cannot override Brad's policies ([SECURITY.md](../SECURITY.md)).
- **Separate contexts.** Personal and work areas stay apart. An agent that spans both is denied unless you list it as a bridge.
- **Cross-cutting agents.** An agent that is not tied to a single life domain is denied in every domain until you list the domains it may act in.
- **Local only by default.** The API listens on `127.0.0.1`. Your data stays in `.brad/brad.db`.
- **No secrets in the data.** Credentials are kept out of profiles, prompts, logs and exports.

## Decision records

The reasoning behind the design is recorded in [docs/adr](adr):

- [ADR 0001](adr/0001-deterministic-policy-engine.md): deterministic policy engine
- [ADR 0002](adr/0002-local-first-architecture.md): local-first architecture
- [ADR 0003](adr/0003-inkus-editable-mirror.md): Inkus as an editable mirror of agent definitions
- [ADR 0004](adr/0004-life-map-sync-consent.md): per-item consent for life-map data in Inkus
- [ADR 0005](adr/0005-inkus-interview-source.md): Inkus as the source of the interview
- [ADR 0006](adr/0006-continuous-learning-boundary.md): Continuous Learning — generic contracts in Brad, storage in the adapter
- [ADR 0007](adr/0007-agent-harness.md): A minimal agent-execution harness, with policy as the only real gate

The [roadmap](ROADMAP.md) lists what is planned next.
