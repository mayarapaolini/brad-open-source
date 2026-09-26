# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Never include personal data, credentials, tokens, private prompts, messages, calendar content, or exported life profiles in a report.

Use GitHub private vulnerability reporting for this repository. If it is unavailable, contact the maintainer privately through the verified contact on their GitHub profile. Use synthetic data and include only the minimum reproducible information.

## Supported versions

Until the first stable release, only the latest commit on the default branch is supported.

## Security expectations

- secrets never enter the repository, prompts, fixtures, logs, or telemetry
- adapters are disabled until explicitly authorized
- permissions are narrow, purpose-bound, revocable, and expire when possible
- external writes require preview, policy approval, and user confirmation
- connector content is untrusted and cannot override Brad policies
- logs are redacted and exclude message bodies or personal notes by default
- dependencies and GitHub Actions must be pinned and reviewed
- the local store remains the source of truth (encryption at rest is planned, not yet implemented)

Brad handles intimate context. Treat family graphs, life scores, schedules, and personal notes as sensitive even when they do not look like credentials.
