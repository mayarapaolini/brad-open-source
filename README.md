# Brad

**Brad is a local-first control plane that transforms a person's priorities, relationships and constraints into a governed portfolio of AI agents.**

> **Status:** functional local MVP. The diagnostic, adaptive discovery, secretary, life map, agent generation, lifecycle, permission grants, policy simulation, correction loop, audit, version history, import/export and CLI run today. The Inkus adapter (agent sync, interview catalog and answers, draft versions) is implemented and tested against a synthetic Inkus and a local MCP server; the connection to a real Inkus workspace is not verified yet (see [the runbook](docs/INTEGRATIONS.md#verifying-against-your-inkus)). Other adapters and real-world inbox/calendar integrations are not implemented.

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
2. **Discovery:** an adaptive conversation per area. A hard, important area starts with what it means and what gets in the way; an area that goes well asks what to protect; a middling one asks first whether you want any change. Every question offers "Another answer" plus free text, skip, "I don't know" and "I'd rather not answer". Brad then restates what it understood and asks "Did I get it right?"; nothing becomes a fact until you confirm. The questions can come from Brad or from an **editable catalog in Inkus**: reload them after editing in Inkus, with no code change. Brad follows each question's branching rule, brings in answers already stored there, sends new ones back as new rows, and lists any score in Inkus that differs from your life map instead of changing it. With Brad's own questions, each answer has its own "sync with Inkus" switch, off by default.
3. **Secretary:** Brad turns your answers into at most three focuses, and one slot protects an important area that is going well. Each proposal says why (your scores and answers, with their dates), how confident it is (high only once you confirmed the answers) and what is missing; the areas that wait are listed with the trade-off. You accept, adjust, snooze for a week or decline, and declining counts as a valid answer. You can silence an area, and a weekly "was this week lighter or heavier?" check-in is optional. A Personal / Work switch keeps the two contexts apart. You can also prepare a **summary to share** with someone in one context: it lists areas, goals and agreed focuses only, never your answers; areas from the other context never go in, and health and finances stay out unless you tick them for that one summary. The secretary never sends, schedules or pays anything.
4. **Life map:** you edit goals, the people who matter (relationship, priority, who may interrupt quiet hours) and boundaries: quiet hours, capabilities no agent may ever use, areas where Brad must always ask first, and which areas count as work (work and study by default; the rest is personal).
5. **Draft agents:** Brad proposes one agent for each area that matters a lot or is neglected. Every agent starts as a `draft` with **no permissions**. Capabilities are only *requested*, and those your boundaries forbid are dropped.
6. **Simulation:** Brad ranks a synthetic inbox and answers questions like *"why did this family message get priority?"* Each score is a sum of named rules you can inspect.
7. **Policy engine:** you ask *"can this agent do this?"* and get `allow`, `deny` or `confirm` with a full rule trace. Deny by default, fixed rule order, and no LLM involved. An agent that would mix personal and work areas is denied unless you allow it as a bridge.
8. **Governance:** an agent moves `draft → configured → simulated → approved → active` only when it has a goal, requested capabilities, a policy simulation you have seen and a current grant. You grant capabilities for 30 days and can revoke them at any time; a revoked grant denies the action immediately.
9. **Correction loop:** when a ranking looks wrong, mark the item as *should be Now / Today / Later*. Brad records the feedback, proposes one concrete life-map change (for example *"Let Jordan Blake interrupt quiet hours: score 61 → 86, Today → Now"*) and applies it only when you click. Adding a new person is never automatic.
10. **Audit:** every simulation, lifecycle change and permission change is recorded locally and shown newest first. Export/import moves your life map, agents and grants as JSON. An import is previewed first (what changes, warnings such as a UTC time zone), applied only once, and can be undone; imported active agents arrive paused. Brad keeps the previous version before every life-map change and every answer (the last 50); you can restore everything, only the life map or only the answers, and undo the restore.

## CLI

Operate the local store without the Studio. Paths are relative to where you run the command.

```bash
pnpm -s brad validate export.json              # an export or a bare life map; exit 1 on problems
pnpm -s brad export --out export.json          # your life map, agents and grants (keep it private)
pnpm -s brad import export.json                # preview only: nothing changes (exit 2)
pnpm -s brad import export.json --yes          # apply; active agents arrive paused, undo in Audit
pnpm -s brad doctor                            # where the data is and what it holds, counts only
pnpm -s brad inkus check                       # read-only check of your Inkus setup
```

## Works today · in development · planned

| Works today | In development | Planned |
| --- | --- | --- |
| Local Studio (EN/PT) | Verification against a real Inkus workspace | Encryption at rest for the local store |
| Wheel of Life diagnostic | Inkus two-way sync: implemented and tested with a synthetic Inkus; real-workspace verification pending | Obsidian adapter |
| Editable life map: goals, people, boundaries | | Real inbox and calendar connectors |
| Draft agent generation (no grants) | | Narrow, confirm-first automation recipes |
| Agent lifecycle with enforced requirements | | Threat model and security review |
| Time-boxed grants with revocation | | |
| Adaptive discovery questions with "Another answer" everywhere, confirmable synthesis, per-answer Inkus consent (a second confirmation for sensitive areas) | | |
| Interview from an editable Inkus catalog: branching rules, answers read from and written to Inkus, offline copy (tested with a synthetic Inkus) | | |
| Interview answers → proposed agent update → draft version in Inkus; activation only by the owner | | |
| Secretary: at most three focuses with evidence, confidence and trade-offs; one protected area; accept/adjust/snooze/decline; per-area silence; optional weekly check-in | | |
| Personal / work contexts: a policy rule, owner bridges and a Secretary filter | | |
| Summary to share, with sensitive areas left out unless consented for that summary | | |
| Version history for the life map and answers, with partial restore and undo | | |
| Explainable priority simulation | | |
| Correction loop: feedback → suggested change → apply | | |
| Deterministic policy engine with what-if checks | | |
| Local decision history (audit view) | | |
| JSON export/import with a diff preview, time-zone check and undo (previous versions) | | |
| Local SQLite persistence (`node:sqlite`) | | |
| Synthetic demo profile | | |
| CLI: `validate`, `export`, `import` (preview, then `--yes`), `doctor`, read-only `inkus check` | | |
| Unit tests for permission, denial, lifecycle and prioritisation, plus a browser end-to-end test | | |
| CI: lint, typecheck, tests, build, e2e | | |

## Optional adapters (not required)

- **Inkus:** two-way sync of agent definitions. Edit an agent in Brad or in Inkus and the next sync reconciles it; Brad's changes arrive in Inkus as drafts that you activate; deprecated Inkus versions are never loaded, same-domain agents are linked rather than duplicated, and new Inkus agents are only created on request. Grants, lifecycle state, people and history never leave Brad, and an Inkus edit can never grant a capability or activate an agent. Enable with `BRAD_ADAPTER_INKUS_ENABLED=true`, `BRAD_INKUS_MCP_URL` and `BRAD_INKUS_TOKEN`; try it offline with `BRAD_INKUS_FAKE=1`. See [ADR 0003](docs/adr/0003-inkus-editable-mirror.md). For the interview, also set `BRAD_INKUS_QUESTIONS_DB` and `BRAD_INKUS_ANSWERS_DB` to your Inkus database ids ([ADR 0005](docs/adr/0005-inkus-interview-source.md)).
- **Obsidian:** would import and export Markdown notes you pick. It never scans a whole vault.
- **Hermes:** runs agents from their active Inkus spec. Brad writes every change to Inkus as a draft, so Hermes follows it only after you activate it. Letting Hermes query Brad's policy engine directly is still open.

The MVP runs without any of them. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/studio` | React + Vite interface: diagnostic, discovery, secretary, life map, agents, simulation |
| `apps/api` | Localhost-only HTTP API and SQLite store |
| `apps/cli` | Command line: validate, export, import, doctor, read-only Inkus check |
| `packages/domain` | Life map types, validation, synthetic demo data |
| `packages/agent-factory` | Life map → draft agents |
| `packages/priority-engine` | Explainable ranking of incoming items |
| `packages/policy-engine` | Deterministic allow / deny / confirm decisions |
| `packages/discovery` | Question catalogs (built-in and Inkus), adaptive discovery engine and synthesis |
| `packages/secretary` | Proposals from confirmed answers, focus plan and owner-control metrics |
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
