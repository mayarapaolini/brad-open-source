# Brad Open Source

Brad is a local-first control plane for designing, governing, and refining a personal system of AI agents.

It begins with a **Wheel of Life diagnostic** because people do not always know which agents they need. Brad helps a person map the areas of life that matter, understand priorities and boundaries, and generate a coordinated set of agents instead of disconnected bots.

## Life domains

- family and close relationships
- work and career
- study and learning
- health and wellbeing
- finances
- home and daily operations
- social life and community
- hobbies, creativity, and leisure
- personal growth and spirituality
- contribution and impact

Example: a scheduling or inbox agent can prioritize a message from a close family member only after the user identifies that relationship, defines the desired priority, and grants the relevant permission.

## Architecture

- **Brad Studio:** local interface for the diagnostic, life map, agents, permissions, simulations, and audit.
- **Brad Core:** domain model, agent factory, prioritization, policy evaluation, and adapter contracts.
- **Inkus:** opt-in publication and collaboration for approved agent definitions and documentation.
- **Obsidian:** user-selected Markdown knowledge import and export.
- **Hermes:** execution and operations panel, receiving only the minimum context allowed for a task.

The local encrypted store is the source of truth. Integrations receive purpose-bound projections, never the full personal profile by default.

## Safety principles

- local-first and offline-capable
- deny by default and least privilege
- no credentials in profiles, prompts, logs, or exports
- preview and confirmation before consequential actions
- provenance, audit history, revocation, and reversible changes
- no silent surveillance or background ingestion
- sensitive data is minimized and redacted
- the Wheel of Life is reflective guidance, not a medical or psychological diagnosis

## Status

The repository is in the **foundation/specification** stage. The first milestone is a local diagnostic that produces an editable life map and draft agent portfolio without connecting to external services.

## Planned monorepo

- `apps/studio` — Brad Multiple Agents panel
- `apps/api` — localhost-only API boundary
- `apps/cli` — validation, import/export, and migrations
- `packages/domain` — life map and agent definitions
- `packages/policy-engine` — consent and action gates
- `packages/priority-engine` — explainable ranking
- `packages/agent-factory` — draft-agent generation
- `packages/adapter-sdk` — Inkus, Obsidian, and Hermes contracts

Read [SECURITY.md](SECURITY.md) before contributing. Never use real personal data, tokens, or private messages in examples, issues, tests, or screenshots.

Licensed under Apache-2.0.
