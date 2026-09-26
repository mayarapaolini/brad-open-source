# Brad

**Brad is a local-first control plane that transforms a person's priorities, relationships and constraints into a governed portfolio of AI agents.**

> **Status:** functional local MVP. The diagnostic, life map, agent generation, lifecycle, permission grants, policy simulation, correction loop, audit and import/export run today. Two-way Inkus sync is implemented and tested against a synthetic Inkus; the connection to a real Inkus workspace is not verified yet. Other adapters and real-world inbox/calendar integrations are not implemented.

![Brad Studio demo: diagnostic, draft agents, explained prioritisation, policy decisions, governance and audit](docs/assets/demo.gif)

## Run it

Requires Node.js ≥ 22.13 and pnpm (`corepack enable`).

```bash
git clone https://github.com/mayarapaolini/brad-open-source.git && cd brad-open-source
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173> and click **Load demo profile**. Everything runs on your machine. The API only listens on `127.0.0.1`, and data lives in `.brad/brad.db`.

## What the MVP does

1. **Diagnostic:** you rate each life area for satisfaction and importance. The Wheel of Life is only the discovery step that shows which agents you need. It is not a medical or psychological assessment.
2. **Discovery:** an adaptive conversation per area. A hard, important area starts with what it means and what gets in the way; an area that goes well asks what to protect; a middling one asks first whether you want any change. Every question offers "Another answer" plus free text, skip, "I don't know" and "I'd rather not answer". Brad then restates what it understood and asks "Did I get it right?"; nothing becomes a fact until you confirm. Each answer has its own "sync with Inkus" switch, off by default.
3. **Life map:** you edit goals, the people who matter (relationship, priority, who may interrupt quiet hours) and boundaries: quiet hours, capabilities no agent may ever use, and areas where Brad must always ask first.
4. **Draft agents:** Brad proposes one agent for each area that matters a lot or is neglected. Every agent starts as a `draft` with **no permissions**. Capabilities are only *requested*, and those your boundaries forbid are dropped.
5. **Simulation:** Brad ranks a synthetic inbox and answers questions like *"why did this family message get priority?"* Each score is a sum of named rules you can inspect.
6. **Policy engine:** you ask *"can this agent do this?"* and get `allow`, `deny` or `confirm` with a full rule trace. Deny by default, fixed rule order, and no LLM involved.
7. **Governance:** an agent moves `draft → configured → simulated → approved → active` only when it has a goal, requested capabilities, a policy simulation you have seen and a current grant. You grant capabilities for 30 days and can revoke them at any time; a revoked grant denies the action immediately.
8. **Correction loop:** when a ranking looks wrong, mark the item as *should be Now / Today / Later*. Brad records the feedback, proposes one concrete life-map change (for example *"Let Jordan Blake interrupt quiet hours: score 61 → 86, Today → Now"*) and applies it only when you click. Adding a new person is never automatic.
9. **Audit:** every simulation, lifecycle change and permission change is recorded locally and shown newest first. Export/import moves your life map, agents and grants as JSON. An import is previewed first (what changes, warnings such as a UTC time zone), applied only once, and can be undone; imported active agents arrive paused.

## Works today · in development · planned

| Works today | In development | Planned |
| --- | --- | --- |
| Local Studio (EN/PT) | CLI for validation and migrations | Encryption at rest for the local store |
| Wheel of Life diagnostic | Inkus two-way sync: implemented and tested with a synthetic Inkus; real-workspace verification pending | Obsidian adapter |
| Editable life map: goals, people, boundaries | | Real inbox and calendar connectors |
| Draft agent generation (no grants) | | Narrow, confirm-first automation recipes |
| Agent lifecycle with enforced requirements | | Threat model and security review |
| Time-boxed grants with revocation | | |
| Adaptive discovery questions with "Another answer" everywhere, confirmable synthesis, per-answer Inkus consent | | |
| Explainable priority simulation | | |
| Correction loop: feedback → suggested change → apply | | |
| Deterministic policy engine with what-if checks | | |
| Local decision history (audit view) | | |
| JSON export/import with a diff preview, time-zone check and undo (previous versions) | | |
| Local SQLite persistence (`node:sqlite`) | | |
| Synthetic demo profile | | |
| Unit tests for permission, denial, lifecycle and prioritisation, plus a browser end-to-end test | | |
| CI: lint, typecheck, tests, build, e2e | | |

## Optional adapters (not required)

- **Inkus:** two-way sync of agent definitions. Edit an agent in Brad or in Inkus and the next sync reconciles it; deprecated Inkus versions are never loaded, same-domain agents are linked rather than duplicated, and new Inkus agents are only created on request. Grants, lifecycle state, people and history never leave Brad, and an Inkus edit can never grant a capability or activate an agent. Enable with `BRAD_ADAPTER_INKUS_ENABLED=true`, `BRAD_INKUS_MCP_URL` and `BRAD_INKUS_TOKEN`; try it offline with `BRAD_INKUS_FAKE=1`. See [ADR 0003](docs/adr/0003-inkus-editable-mirror.md).
- **Obsidian:** would import and export Markdown notes you pick. It never scans a whole vault.
- **Hermes:** runs agents from their active Inkus spec, so it follows Brad's edits after each sync. Letting Hermes query Brad's policy engine directly is still open.

The MVP runs without any of them. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/studio` | React + Vite interface: diagnostic, life map, agents, simulation |
| `apps/api` | Localhost-only HTTP API and SQLite store |
| `packages/domain` | Life map types, validation, synthetic demo data |
| `packages/agent-factory` | Life map → draft agents |
| `packages/priority-engine` | Explainable ranking of incoming items |
| `packages/policy-engine` | Deterministic allow / deny / confirm decisions |
| `packages/discovery` | Question catalog, adaptive discovery engine and synthesis |
| `packages/adapter-inkus` | Inkus mapping, two-way sync and MCP client (plus an in-memory fake for tests) |

```bash
pnpm lint && pnpm typecheck && pnpm test   # fast checks
pnpm build && pnpm test:e2e                # browser flow (needs a Playwright Chromium)
pnpm demo:gif                              # re-record docs/assets/demo.gif
```

## Safety principles

- local-first; no network services and no LLM in the MVP
- deny by default and least privilege; drafts can never act
- no credentials in profiles, prompts, logs or exports
- confirmation before consequential actions (send, schedule, delete, pay)
- every decision is explainable and recorded locally
- only synthetic data in examples, tests and screenshots

Read [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. How Brad is built, including the use of Claude Code as a development partner: [DEVELOPMENT.md](DEVELOPMENT.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and decision records in [docs/adr](docs/adr). Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md).

Licensed under Apache-2.0.
