# Integrations

Integrations are optional adapters. Brad remains useful without them.

| System | Appropriate use | Must not do |
| --- | --- | --- |
| Inkus | Two-way sync of agent definitions (see [ADR 0003](adr/0003-inkus-editable-mirror.md)); interview questions and answers from its databases ([ADR 0005](adr/0005-inkus-interview-source.md)); Continuous Learning Phase 1 — record/recall learning events through an adapter implementing Brad's generic `MemoryProvider` contract ([ADR 0006](adr/0006-continuous-learning-boundary.md)) | Receive credentials, grants, people or history; grant capabilities or change lifecycle state |
| Obsidian | Import/export user-selected Markdown notes and frontmatter | Scan a whole vault by default or rewrite notes without preview |
| Hermes | Execute agents from their active Inkus spec (Brad only writes drafts; the owner activates); display runs, queues, and errors | Bypass Brad policies or receive unrelated life context |

## Adapter contract

Every adapter declares capabilities, required scopes, resources, accepted data classifications, authentication, retention, deletion, retry behavior, health checks, revocation, and audit events.

Adapters start disabled. Connection tests use synthetic or metadata-only requests. Users can inspect, pause, revoke, and delete connections from Brad Studio.

Synchronization uses stable IDs, schema versions, hashes, and provenance. Brad exports only the projection needed by the destination. Conflicts create a review item instead of silently merging personal intent.

## Verifying against your Inkus

The Inkus adapter is tested against a synthetic Inkus. To check it against your own workspace, run Brad locally with your settings in the environment. Never put them in a file inside the repository.

```bash
export BRAD_ADAPTER_INKUS_ENABLED=true
export BRAD_INKUS_MCP_URL=https://<your-inkus>/mcp
export BRAD_INKUS_TOKEN=<token>             # from your keychain or a secret manager
export BRAD_INKUS_QUESTIONS_DB=<question database id>
export BRAD_INKUS_ANSWERS_DB=<answers database id>
```

On Windows (PowerShell), set them like this. They last only for that window:

```powershell
$env:BRAD_ADAPTER_INKUS_ENABLED = "true"
$env:BRAD_INKUS_MCP_URL = "https://<your-inkus>/mcp"
$env:BRAD_INKUS_TOKEN = "<token>"
$env:BRAD_INKUS_QUESTIONS_DB = "<question database id>"
$env:BRAD_INKUS_ANSWERS_DB = "<answers database id>"
```

Then go step by step. Each step only goes as far as it says.

1. `pnpm run brad inkus check` is **read-only**. It shows the agent count, whether each agent has an active version, and the question catalog with any problems. It also counts the answers and flags any that point to questions missing from the catalog.
2. `pnpm dev`, then **Discovery → Reload questions from Inkus** reads the catalog and keeps a local copy. Switch to **Questions from Inkus**.
3. **Sync answers with Inkus** brings in your stored answers and lists any score that differs from the life map (nothing is applied). Answers you give from then on are written as new rows.
4. **Agents → Sync with Inkus** links or imports your agents. Brad's edits arrive in Inkus as **drafts**.
5. On one agent card, **Apply and create a draft in Inkus** from the interview proposal. Check the draft in Inkus, then activate it in Inkus or with **Activate in Inkus**.

If something fails, the Studio and the audit history say which step and why. The local data stays as it was. "Token de API inválido ou revogado" means Inkus rejected `BRAD_INKUS_TOKEN`: create a new API token in Inkus and set it again.

## Continuous Learning (Phase 1)

`pnpm run brad learning demo` runs the full Phase-1 cycle — record a correction with evidence,
recall it in a fresh session, apply it to an equivalent synthetic task, and verify the result
objectively (`pass`/`fail`/`indeterminate`) — entirely against the synthetic workspace
(`BRAD_ADAPTER_INKUS_ENABLED=true BRAD_INKUS_FAKE=1`). It refuses to run against a real
connection: a pilot against live data is a separate, explicitly-approved step. See
[ADR 0006](adr/0006-continuous-learning-boundary.md) for the contract/adapter boundary and the
open PRD decisions it resolves.
