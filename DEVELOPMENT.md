# Development

How Brad is built, who decides what, and how changes are verified.

## Roles

**The maintainer** owns the product: the thesis, the architecture, the governance model (lifecycle, permissions, deny-by-default policy), the safety principles, the acceptance criteria for every change, and the decision to merge. All pull requests are reviewed and merged by the maintainer.

**Claude Code** is used as a development partner. It proposes implementation plans, writes code, tests and documentation, runs the checks, and opens pull requests against the plan the maintainer approved. It does not merge pull requests, publish releases or issues, or change the product direction on its own.

Nothing is hidden about this split:

- Commits written with Claude Code carry a `Co-Authored-By: Claude …` trailer and a link to the session that produced them.
- History is not squashed or rewritten to change authorship. Pull requests are merged with merge commits.

## How a change moves

1. **Intent:** the maintainer states the goal and the constraints, for example "no LLM in the policy path" or "synthetic data only".
2. **Plan:** a written plan names the files to change, the rules to enforce and how the result will be verified. The maintainer approves it before any code is written.
3. **Implementation:** small commits on a feature branch.
4. **Verification:** every change must pass the same gates locally and in CI:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test   # unit tests
   pnpm build && pnpm test:e2e                # Playwright flow through the real Studio
   ```
   The end-to-end script (`scripts/record-demo.mjs`) asserts product behaviour, not just rendering. For example, it checks that a draft agent is denied, that revoking a grant denies the action immediately, and that a correction moves an item. The same run records `docs/assets/demo.gif`, and its screenshots are reviewed before the GIF is committed.
5. **Review:** the pull request describes what changed, how it was tested, and the privacy and permission implications (see [CONTRIBUTING.md](CONTRIBUTING.md)). CI runs on every pull request.
6. **Merge:** by the maintainer only. Follow-up work restarts from the updated `main`, and a merged pull request is never reused.

## Rules that do not bend

- **Deterministic core.** Agent generation, prioritisation, policy decisions and correction suggestions are pure functions with no LLM, network or hidden clock. See [ADR 0001](docs/adr/0001-deterministic-policy-engine.md).
- **Local-first.** The API binds to `127.0.0.1` and data stays in a local SQLite file. See [ADR 0002](docs/adr/0002-local-first-architecture.md).
- **Synthetic data only** in fixtures, tests, screenshots, issues and examples.
- **Honest status.** The README's *works today / in development / planned* table is updated in the same pull request that changes what works. Features that don't exist yet, such as encryption at rest, are never described as existing.
- **No weakening tests to get green.** A failing check is fixed at the root.

## Local setup

Requires Node.js ≥ 22.13 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev            # API on 127.0.0.1:4317, Studio on 127.0.0.1:5173
```

Data lives in `.brad/brad.db` (git-ignored). Set `BRAD_DATA_DIR` to use another directory. For the browser test, a Playwright Chromium is needed once: `pnpm exec playwright install chromium`.

## Repository map

| Path | What lives there |
| --- | --- |
| `packages/domain` | Types, validation, lifecycle rules, export format, synthetic demo data |
| `packages/agent-factory` | Life map → draft agents; reconciliation on regenerate |
| `packages/priority-engine` | Explainable ranking and correction suggestions |
| `packages/policy-engine` | Deterministic allow / deny / confirm with a rule trace |
| `apps/api` | Localhost-only HTTP API and SQLite store |
| `apps/studio` | React + Vite interface (EN/PT) |
| `docs/adr` | Architecture decision records |
