# Architecture

## Boundaries

| Area | Responsibility |
| --- | --- |
| apps/studio | Local UI: onboarding, Wheel of Life, life map, agents, permissions, simulation, audit |
| apps/api | Localhost-only API boundary |
| apps/cli | Import, export, validation, migrations, diagnostics |
| packages/domain | Life domains, people, priorities, goals, boundaries, agents |
| packages/policy-engine | Consent, authorization, risk gates, confirmations |
| packages/priority-engine | Explainable ranking of messages, tasks, and calendar events |
| packages/agent-factory | Converts the life map into editable draft agents |
| packages/adapter-sdk | Capability-based contract for external systems |
| packages/adapter-* | Inkus, Obsidian, and Hermes implementations |

## Source of truth

The local encrypted data store is canonical. Integrations receive projections with purpose, scope, expiry, and provenance. Conflicts never silently overwrite local user intent.

## Core flow

1. The user completes a Wheel of Life reflection.
2. Brad creates an editable life map.
3. The agent factory proposes agents covering every life domain.
4. The user adjusts goals, people, boundaries, and permissions.
5. A simulation explains each prioritization decision.
6. The user enables selected adapters.
7. Every external action passes through policy evaluation and audit.

## Agent lifecycle

draft -> configured -> simulated -> approved -> active -> paused -> archived

An agent cannot become active until its purpose, inputs, permissions, escalation behavior, retention, and owner-visible explanation are defined.

## Core records

- LifeDomain: score, importance, desired direction, evidence, review date
- Person: relationship category and user-defined priority
- AgentDefinition: purpose, triggers, tools, scopes, policy, explanation
- ConsentGrant: adapter, capability, resource scope, purpose, issue and expiry
- DecisionRecord: inputs used, rules applied, result, confidence, correction
