# ADR 0004: Per-item consent for life-map data in Inkus

- **Status:** accepted (consent stored in PR "adaptive discovery"; pushing consented items is a follow-up)
- **Date:** 2026-09-26
- **Amends:** [ADR 0003](0003-inkus-editable-mirror.md), which synced agent definitions only
- **Code:** `packages/discovery` (`Answer.syncToInkus`), `POST /api/discovery/answers/sync`

## Context

The PRD "Brad como secretária da vida" places the life map, the question catalog and the answers (with their origin) in Inkus, next to agent definitions. It leaves open *which* personal data may leave the local Studio, especially health, finances and people. The owner decided: **everything may sync, with consent per item, off by default.**

## Decision

- **Answers carry a consent flag.** Every discovery answer has `syncToInkus: false` when created. Only the owner can turn it on, per answer, in the Studio. Each change is recorded in the decision history.
- **Editing keeps consent.** A new version of an answer inherits the previous version's flag, so an edit never silently starts or stops syncing.
- **The question catalog is product content,** not personal data. It can be published to Inkus without consent.
- **Sensitive areas need a second yes.** Turning sync on for an answer in a sensitive area (health and finances by default, `boundaries.sensitiveDomains`) is refused with `sensitive_confirmation_required` unless the request also carries `confirmSensitive: true`, which the Studio sends only after an explicit confirmation. The decision record notes that the area was sensitive.
- **Still never synced:** grants, decision history, credentials, and anything whose flag is off.
- **Delivery is staged.** This PR stores and shows the consent. Pushing consented items to Inkus arrives in a follow-up once the target structure in Inkus is agreed (database records or versioned texts). Until then, nothing personal leaves the machine.

## Consequences

- The owner can share exactly the answers they choose, one at a time, and see and revoke each choice.
- Health and finance answers start off like every other answer, and turning them on takes a second, explicit confirmation. PRD RF11 applies the same idea to the summary to share: sensitive areas stay out unless the owner ticks them for that one summary, and the tick is not stored as a standing permission.
- Revoking consent later must also remove or archive the item in Inkus. That is part of the follow-up and is tracked there.
