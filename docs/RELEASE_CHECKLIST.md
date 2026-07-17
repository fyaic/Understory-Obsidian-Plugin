# Understory 1.13.1 Release Evidence

Date: 2026-07-17

## Scope

This patch release fixes the Advanced diagnostics hierarchy and styling. Hosted authentication, provider routing, account data, note-analysis behavior, and the bundled local-engine snapshot are unchanged.

## Automated Gates

- [x] Manifest, package, lockfile, versions, changelog, release notes, and provenance use `1.13.1`.
- [x] Official Obsidian ESLint rules pass with zero warnings.
- [x] All 100 JavaScript, Python CLI, local engine, MCP, settings, sidebar, account, and hosted integration tests pass.
- [x] `main.js` rebuild is deterministic and passes `node --check`.
- [x] Release metadata, privacy/payment disclosures, and tag/version consistency pass.
- [x] A local-only `api.py init` smoke passes.
- [x] CI rejects a generated `main.js` diff.
- [x] Tag releases attest and upload exactly `manifest.json`, `main.js`, and `styles.css`.

## Real Obsidian Smoke

Environment: Obsidian 1.12.7 on macOS, `AIC-000` plus isolated `Understory-UI-Smoke-Vault`.

- [x] Confirm a disconnected user sees one Bondie sign-in action and no provider/Python setup.
- [x] Complete the browser login callback and verify name, email, avatar, Free membership, and service readiness.
- [x] Generate real hosted suggestions and risks from a non-sensitive smoke note without repeated error notifications.
- [x] Verify relation discovery and risk analysis are attributed to the account in operator usage.
- [x] Verify Account, Usage, Workflow, Scope, Suggestions, Activity, and AI agents remain usable.
- [x] Install the 1.13.1 build in both local test vaults without replacing `data.json`.
- [x] Verify Advanced initially shows only collapsed Service, Local engine, Technical diagnostics, and Connection diagnostics sections.
- [x] Expand Technical diagnostics and verify versions, paths, checks, fixes, commands, and actions remain readable in light and dark themes.
- [x] Recheck narrow settings layout for overflow or wrapped controls.

## Engine Provenance

- [x] The bundled engine digest remains `cac720e1033b6be233b9d4b99059604654e5cdcb78d0b688464d66792eb73743`.
- [x] `engine-provenance.json` records that 1.13.1 inherits the byte-identical 1.13.0 snapshot.
- [x] The release checker rejects any modified legacy snapshot and requires a full upstream core commit when engine source changes.

## Publish

- [x] Merge the reviewed 1.13.1 commit to the public repository default branch (`8079a330c2aeb2c79cbca578247c8e6f3d934ec9`).
- [x] Push Git tag `1.13.1` and verify the attested [GitHub release](https://github.com/fyaic/Understory-Obsidian-Plugin/releases/tag/1.13.1).

Verified release asset digests:

- `main.js`: `ae2abeb4142da08f105887d6c3a17c2a5bb4973ce324b06d523e3a7224695fac`
- `manifest.json`: `ebc30803b45d0366ea96e71932148f9eb3840260763a4eb40dabc7e0c57066bb`
- `styles.css`: `b0ba656faa5c3449ce4824beec9ca0fe50e65dd78e7be405966271c0ca1fdc8d`

## Community Directory

- [ ] Run an Obsidian Community dashboard preview scan against the release commit.
- [ ] Set the Community pricing label to **Optional payments**.
- [ ] Upload current light and dark product screenshots in the Community dashboard.
- [ ] Submit or update the Community listing after the automated scorecard passes.
