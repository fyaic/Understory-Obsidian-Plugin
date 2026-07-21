# Understory 1.13.3 Release Checklist

Date: 2026-07-21

## Scope

This patch keeps the public repository's Obsidian Community release packaging
stable across Windows and GitHub Actions. It changes release tooling and
version metadata only. Hosted authentication, provider routing, account data,
note-analysis behavior, saved settings, UI behavior, and the bundled
local-engine snapshot remain unchanged.

## Automated Gates

- [x] Manifest, package, lockfile, versions, changelog, release notes, and provenance use `1.13.3`.
- [x] Official Obsidian ESLint rules pass with zero warnings.
- [x] All 101 JavaScript, Python CLI, local engine, MCP, settings, sidebar, account, and hosted integration tests pass.
- [x] `main.js` is ignored and absent from tracked source files.
- [x] Two independent clean bundle builds are byte-identical and pass `node --check`.
- [x] Release metadata, privacy/payment disclosures, and tag/version consistency pass.
- [x] A local-only `api.py init` smoke passes.
- [x] No raw `h1`-`h6` elements are created from plugin source.
- [x] Tag releases attest and upload exactly `manifest.json`, `main.js`, and `styles.css`.

## Real Obsidian Smoke

Environment: Obsidian 1.12.7 on macOS, isolated `Understory-UI-Smoke-Vault`.

- [ ] Install the generated 1.13.3 assets without replacing `data.json`.
- [x] Reload the plugin and verify the existing Bondie product session reconnects.
- [x] Verify name, email, avatar, Free membership, and service readiness.
- [x] Verify the sidebar title and conflict groups retain their visual hierarchy.
- [x] Open the snippet-consent and global-logout confirmations and verify native modal titles.
- [x] Generate hosted suggestions and risks without repeated error notifications.
- [x] Verify Account, Usage, Workflow, Scope, Suggestions, Activity, AI agents, and Advanced remain usable.

## Engine Provenance

- [x] The bundled engine digest remains `cac720e1033b6be233b9d4b99059604654e5cdcb78d0b688464d66792eb73743`.
- [x] `engine-provenance.json` records that 1.13.3 inherits the byte-identical 1.13.0 snapshot.
- [x] The release checker rejects any modified legacy snapshot and requires a full upstream core commit when engine source changes.

## Publish

- [ ] Merge the reviewed 1.13.3 commit to the public repository default branch.
- [ ] Push Git tag `1.13.3` from that exact merge commit.
- [ ] Verify the GitHub release contains only the three install assets with attestations.
- [ ] Install the final release assets and verify their digests against the local build.

Release evidence:

| Item | Verified result |
| --- | --- |
| Reviewed PR | Pending |
| Merge commit | Pending |
| Release | Pending |
| `main.js` | Pending |
| `manifest.json` | Pending |
| `styles.css` | Pending |
| Local install | Pending |

## Community Directory

- [x] Confirm the Community listing pricing remains **Optional payments**.
- [x] Confirm the public automated Health score is **Excellent** after release.
- [ ] Upload or retain current light and dark product screenshots in the Community dashboard.
- [ ] Resolve any dashboard-only disclosure or ownership prompts that require the maintainer account.
