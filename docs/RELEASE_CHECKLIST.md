# Understory 1.13.9 Release Checklist

Date: 2026-07-23

## Scope

This patch makes automatic-refresh scope visible in the current-note sidebar.
Manual analysis remains available outside the configured scope, while the
notice explains that full-vault and scheduled refreshes skip that folder. The
notice links directly to Scope settings.

Hosted authentication, account data, analysis endpoints, saved settings, and
the bundled local-engine snapshot are unchanged.

## Automated Gates

- [x] Manifest, package, lockfile, versions, changelog, release notes, and
  provenance use `1.13.9`.
- [x] Official Obsidian ESLint rules pass with zero warnings.
- [x] All 103 JavaScript, Python CLI, local engine, MCP, settings, sidebar,
  account, and hosted integration tests pass.
- [x] Refresh-scope tests cover normalized folder matching, an empty whitelist,
  and globally excluded folders.
- [x] `main.js` is ignored and absent from tracked source files.
- [x] Two independent clean bundle builds are byte-identical and pass
  `node --check`.
- [x] Candidate bundle SHA-256:
  `78776371f41e7f183bfbb12aded7a3218dd05b178c2661c7e5fc7a81726b0f62`.
- [x] Release metadata, privacy/payment disclosures, tag/version consistency,
  and local-engine smoke checks pass.
- [x] Tag releases attest and upload exactly `manifest.json`, `main.js`, and
  `styles.css`.

## Real Obsidian Smoke

Environment: Obsidian 1.12.7 on macOS, isolated
`Understory-UI-Smoke-Vault`.

- [x] Install the final 1.13.9 candidate without replacing `data.json`.
- [x] Reload the plugin and verify the existing Bondie product session
  reconnects.
- [x] Verify account identity, avatar, email, Free membership, and managed
  service readiness.
- [x] Verify hosted relations, risks, principles, embeddings, full-vault
  analysis, and Usage remain usable.
- [x] Verify an out-of-scope note shows one compact notice while retaining its
  existing manual suggestions and risks.
- [x] Verify **Review scope** opens Understory's Scope page.
- [x] Verify an in-scope note does not show the notice.
- [x] Verify no repeated error notifications appear.

## Engine Provenance

- [x] The bundled engine digest remains
  `cac720e1033b6be233b9d4b99059604654e5cdcb78d0b688464d66792eb73743`.
- [x] `engine-provenance.json` records that 1.13.9 inherits the byte-identical,
  attested 1.13.0 snapshot.
- [x] The release checker rejects any modified legacy snapshot and requires a
  full upstream core commit when engine source changes.

## Publish

- [ ] Merge the reviewed 1.13.9 commit to the public repository default branch.
- [ ] Push Git tag `1.13.9` from that exact merge commit.
- [ ] Verify the GitHub release contains only the three install assets with
  attestations.
- [ ] Install the final release assets and verify their digests against the
  locally tested candidate.

## Community Directory

- [x] Community listing pricing remains **Optional payments**.
- [x] The current release remains desktop-only and supports Obsidian 1.8.7 or
  newer.
- [ ] Confirm the automated Community health review remains clean after
  publishing 1.13.9.
- [ ] Complete any dashboard-only disclosure or ownership prompt that requires
  the maintainer account.
