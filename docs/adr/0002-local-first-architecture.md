# ADR 0002: Local-first architecture

- **Status:** accepted, amended by [ADR 0003](0003-inkus-editable-mirror.md) for Inkus
- **Date:** 2026-09-26
- **Code:** `apps/api/src/main.ts`, `apps/api/src/server.ts`, `apps/api/src/store.ts`

## Context

A life map holds some of the most intimate data a person has: family relationships, health and financial priorities, schedules, and who may interrupt them at night. Sending it to a hosted service by default would make Brad another place where that data can leak, be mined or be subpoenaed. It would also make the product unusable offline and dependent on someone else's uptime.

## Decision

The person's machine is the source of truth, and everything in the MVP runs there.

- **Loopback only.** The API binds to `127.0.0.1` and rejects requests whose `Host` header is not local, which guards against DNS rebinding.
- **Local storage.** Data lives in one SQLite file (`.brad/brad.db`), read and written through the built-in `node:sqlite`. It has no native build step and no database server. Schema changes are versioned migrations (`PRAGMA user_version`).
- **No network services.** The MVP makes no outbound calls and includes no LLM and no telemetry.
- **Explicit portability.** Export and import move the life map, agents and grants as validated JSON. Decision history stays on the machine, and imported active agents arrive paused.
- **Adapters are future and opt-in.** Inkus, Obsidian and Hermes will receive only purpose-bound projections, never the full profile, and every action they take goes through the policy engine ([ADR 0001](0001-deterministic-policy-engine.md)).

## Consequences

- Privacy holds without trusting a server operator. The owner can inspect, copy or delete the file at any time.
- Setup takes three commands (`git clone`, `pnpm install`, `pnpm dev`) with no accounts.
- **Known gap:** the SQLite file is not encrypted yet. Anyone with access to the user account can read it. Encryption at rest is on the roadmap and is stated as *planned* in the README and SECURITY.md.
- There is no multi-device sync. Export/import is the manual path until a sync design exists that keeps the local copy authoritative.
- `node:sqlite` is marked experimental in Node 22. Its API is small and isolated behind `Store`, so it can be swapped if needed.

## Alternatives considered

- **A hosted backend with accounts:** simpler sync, but it contradicts the privacy thesis and adds an operator to trust.
- **Browser-only storage** (IndexedDB): no server process, but harder to back up, inspect or share with future adapters and a CLI.
- **A native SQLite binding** (`better-sqlite3`): mature, but needs a native build that often fails on contributor machines. The built-in module avoids that.
