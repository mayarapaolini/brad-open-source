# Contributing

Thank you for helping build Brad.

## Before contributing

1. Discuss substantial behavior, schema, or integration changes in an issue.
2. Use synthetic data in tests, examples, screenshots, and bug reports.
3. Never submit credentials or real personal-life exports.
4. Keep the local-first boundary intact.
5. Explain privacy and permission implications in the pull request.

## Pull request checklist

- scope is small and documented
- tests cover success, denial, and failure paths
- no personal data or secrets are present
- permissions are explicit, minimal, revocable, and purpose-bound
- consequential actions provide preview and confirmation
- logs are redacted
- schema changes include migration and rollback plans
- dependencies and workflow actions are pinned
- documentation is updated

Domain rules belong in packages, not UI components. Adapters depend on stable contracts and cannot bypass the policy engine.

By contributing, you agree that your contribution is licensed under Apache-2.0.
