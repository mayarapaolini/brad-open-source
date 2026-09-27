# Integrations

Integrations are optional adapters. Brad remains useful without them.

| System | Appropriate use | Must not do |
| --- | --- | --- |
| Inkus | Two-way sync of agent definitions (see [ADR 0003](adr/0003-inkus-editable-mirror.md)); interview questions and answers from its databases ([ADR 0005](adr/0005-inkus-interview-source.md)) | Receive credentials, grants, people or history; grant capabilities or change lifecycle state |
| Obsidian | Import/export user-selected Markdown notes and frontmatter | Scan a whole vault by default or rewrite notes without preview |
| Hermes | Execute agents from their active Inkus spec; display runs, queues, and errors | Bypass Brad policies or receive unrelated life context |

## Adapter contract

Every adapter declares capabilities, required scopes, resources, accepted data classifications, authentication, retention, deletion, retry behavior, health checks, revocation, and audit events.

Adapters start disabled. Connection tests use synthetic or metadata-only requests. Users can inspect, pause, revoke, and delete connections from Brad Studio.

Synchronization uses stable IDs, schema versions, hashes, and provenance. Brad exports only the projection needed by the destination. Conflicts create a review item instead of silently merging personal intent.
