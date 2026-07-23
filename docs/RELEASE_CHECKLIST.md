# Understory 1.13.10 Release Checklist

Date: 2026-07-23

## Scope

This patch makes hosted AI routing opaque to the plugin. Runtime config keeps
only capability endpoints, hosted requests contain content only, and the
plugin does not persist or inject model selections in hosted mode. Advanced
local/self-hosted settings remain available and unchanged.

## Automated Gates

- [x] Manifest, package, lockfile, versions, changelog, release notes, and
  provenance use `1.13.10`.
- [x] Official Obsidian ESLint rules pass with zero warnings.
- [x] JavaScript, Python CLI, local engine, MCP, settings, sidebar, account,
  and hosted integration tests pass.
- [x] Hosted tests prove provider/model metadata is discarded and managed
  runtime environments contain no model selection.
- [x] `main.js` is ignored and absent from tracked source files.
- [x] Two independent clean bundle builds are byte-identical and pass
  `node --check`.
- [x] Candidate bundle SHA-256 is
  `af7cba5bd2e734175b37da3ee6c548eb73204dde1dcbc871450818ad5007ffa9`.
- [x] Release metadata, privacy/payment disclosures, tag/version consistency,
  and local-engine smoke checks pass.
- [x] Tag releases attest and upload exactly `manifest.json`, `main.js`, and
  `styles.css`.

The dependency tree is unchanged from 1.13.9. Two attempts to query npm's
advisory API on 2026-07-23 returned HTTP 503; the release workflow remains the
authoritative online dependency gate.

## Real Obsidian Smoke

Environment: Obsidian 1.12.7 on macOS, isolated
`Understory-UI-Smoke-Vault`.

- [x] Install the final 1.13.10 candidate without replacing `data.json`.
- [x] Reload the plugin and verify the existing Bondie product session
  reconnects.
- [x] Verify account identity, avatar, email, Free membership, and managed
  service readiness.
- [x] Verify hosted relations, risks, principles, embeddings, full-vault
  analysis, and Usage remain usable.
- [x] Verify normal Account and Usage pages expose no provider/model choices.
- [x] Verify Advanced local/self-hosted settings remain available behind their
  dedicated disclosure; local-engine and provider-mode tests pass unchanged.
- [x] Verify no repeated error notifications appear.

## Engine Provenance

- [x] The bundled engine digest remains
  `cac720e1033b6be233b9d4b99059604654e5cdcb78d0b688464d66792eb73743`.
- [x] `engine-provenance.json` records that 1.13.10 inherits the byte-identical,
  attested 1.13.0 snapshot.
- [x] The release checker rejects any modified legacy snapshot and requires a
  full upstream core commit when engine source changes.

## Publish

- [x] Merge the reviewed 1.13.10 commit to the public repository default branch
  as `935cb6d51c17911140f8736c907fe9e65d6649ff`.
- [x] Push Git tag `1.13.10` from that exact merge commit.
- [x] Verify the GitHub release contains only the three install assets with
  attestations.
- [x] Install the final release assets and verify their digests against the
  locally tested candidate.

Release: <https://github.com/fyaic/Understory-Obsidian-Plugin/releases/tag/1.13.10>

```text
main.js       af7cba5bd2e734175b37da3ee6c548eb73204dde1dcbc871450818ad5007ffa9
manifest.json 72302cf4b4d24a82a2bb5c838fdc5f558d07881cd43cd3a335efcc5861d808de
styles.css    36dc439bb8e78a33e912b1e9973a765cf206ae34925ab8505673926231c2f2d1
```

## Community Directory

- [ ] Community listing pricing remains **Optional payments**.
- [x] The current release remains desktop-only and supports Obsidian 1.8.7 or
  newer.
- [ ] Confirm the automated Community health review remains clean after
  publishing 1.13.10.
- [ ] Complete any dashboard-only disclosure or ownership prompt that requires
  the maintainer account.
