# Roadmap

## Milestone 0 — Foundation

- governance, threat model, schemas, and adapter contract
- architecture decision records
- secure CI, dependency review, and secret scanning

## Milestone 1 — Local diagnostic

- [x] Wheel of Life diagnostic (discovery step)
- [x] editable scores, importance, goals, people, and boundaries
- [x] local persistence (SQLite)
- [ ] encryption at rest
- [x] synthetic demo profile
- [x] safe import/export (validated JSON, diff preview, time-zone confirmation, idempotent, undo; imported active agents arrive paused)

## Milestone 2 — Agent portfolio

- [x] draft agents for important or neglected life domains, with no grants
- [x] people and priority mapping
- [x] explainable priority engine
- [x] deterministic policy engine with what-if simulation
- [x] correction loop (owner feedback → one suggested, previewed life-map change)
- [x] adaptive discovery with a confirmable synthesis
- [x] secretary proposals: at most three focuses with evidence and trade-offs, one protected area, optional weekly check-in, no external action
- [x] personal / work context separation (policy rule, owner bridges, Secretary filter)
- [x] summary to share with per-summary consent for sensitive areas
- [x] version history for the life map and answers, with partial restore and undo
- [x] interview from an editable Inkus question catalog; answers read from and written to Inkus
- [ ] draft agent specs from confirmed interview answers (always draft; activation is explicit)

## Milestone 3 — Brad Multiple Agents panel

- [x] agent overview and lifecycle
- [x] permission center (grant, expiry, revoke)
- [x] decision history (audit trail); run timeline pending
- global and per-agent pause
- connection health

## Milestone 4 — Adapters

- Obsidian file adapter
- Inkus publication adapter
- Hermes execution adapter
- contract and revocation tests

## Milestone 5 — Safe automation

- narrowly scoped recipes
- confirmation policies and limits
- rollback and incident recovery
- privacy-preserving optional telemetry
