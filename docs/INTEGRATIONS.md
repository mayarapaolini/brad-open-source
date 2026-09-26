# Integrations

Integrations are optional adapters. Brad remains useful without them.

| System | Appropriate use | Must not do |
| --- | --- | --- |
| Inkus | Publish approved agent definitions, docs, templates, and non-secret configuration | Receive credentials, silently become source of truth, or ingest the whole profile |
| Obsidian | Import/export user-selected Markdown notes and frontmatter | Scan a whole vault by default or rewrite notes without preview |
| Hermes | Execute approved agents and display runs, queues, and errors | Bypass Brad policies or receive unrelated life context |

## Adapter contract

Every adapter declares capabilities, required scopes, resources, accepted data classifications, authentication, retention, deletion, retry behavior, health checks, revocation, and audit events.

Adapters start disabled. Connection tests use synthetic or metadata-only requests. Users can inspect, pause, revoke, and delete connections from Brad Studio.

Synchronization uses stable IDs, schema versions, hashes, and provenance. Brad exports only the projection needed by the destination. Conflicts create a review item instead of silently merging personal intent.
