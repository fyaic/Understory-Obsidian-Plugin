# Security Policy

## Reporting A Vulnerability

Please do not open a public issue for a suspected vulnerability, exposed credential, authentication bypass, or privacy incident.

Use this repository's **Security -> Report a vulnerability** flow to open a private GitHub Security Advisory. Include:

- A concise impact statement.
- The affected Understory and Obsidian versions.
- Reproduction steps or a proof of concept.
- Whether account data, vault content, provider credentials, or hosted usage records may be involved.

Do not include real vault content, access tokens, API keys, or personal account data when a synthetic example can reproduce the issue.

## Supported Versions

Security fixes are applied to the latest published release. Users should update to the newest release before reporting a defect that may already be fixed.

## Security Boundaries

- Hosted provider credentials must remain server-side.
- The plugin stores only the product session needed to call Understory.
- Advanced BYOK credentials are local operator settings and must never appear in diagnostics or commits.
- Agent API paths must remain inside the explicitly selected vault.
- Release assets are produced by GitHub Actions and carry GitHub artifact attestations.

See [PRIVACY.md](PRIVACY.md) for the complete hosted and local data-flow boundaries.
