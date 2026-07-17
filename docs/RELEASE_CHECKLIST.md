# Understory 1.13.0 Release Evidence

Date: 2026-07-15

## Automated Gates

- [x] Manifest, package, lockfile, versions, changelog, and release notes use `1.13.0`.
- [x] Official Obsidian ESLint rules run with zero warnings allowed.
- [x] JavaScript, Python CLI, local engine, MCP, settings, sidebar, account, and hosted integration tests are included in `npm test`.
- [x] `main.js` is rebuilt from all `src/*.js` modules and includes the hosted authentication, client, discovery, and analysis modules.
- [x] `node --check main.js` is part of the release gate.
- [x] Embedded local-engine hashes are checked against source files.
- [x] A local-only `api.py init` smoke test is part of the release gate.
- [x] CI rejects a generated `main.js` diff.
- [x] Tag releases attest and upload exactly `manifest.json`, `main.js`, and `styles.css`.

## Real Obsidian Smoke

Environment: Obsidian 1.12.7 on macOS, isolated `Understory-UI-Smoke-Vault`.

- [x] Install current release assets into the isolated vault.
- [x] Enable, disable, reload, and re-enable the plugin.
- [x] Open the ribbon entry, right sidebar, and settings.
- [x] Verify a disconnected user sees one Bondie sign-in action and no provider/Python setup.
- [x] Complete the browser login callback and product-session exchange.
- [x] Verify email, fallback avatar, Free membership, active state, and service readiness.
- [x] Generate hosted suggestions and risks from a real non-sensitive project document.
- [x] Verify no repeated error notifications occur.
- [x] Verify account usage and per-feature activity are visible after hosted requests.
- [x] Accept one suggestion, ignore another, and insert a third into a scratch note.
- [x] Verify light and dark themes.
- [x] Verify English and Chinese settings/sidebar labels.
- [x] Verify narrow sidebar titles, scores, and icon actions remain readable.

## Compatibility Evidence

- [x] Fresh/no-data settings normalize to hosted mode.
- [x] Existing saved local mode remains local without a Bondie session.
- [x] Hosted mode does not start the Python engine or expose provider-key fields.
- [x] Local, self-hosted, BYOK, Agent API, and MCP workflows remain available under Advanced.
- [x] Legacy English and Chinese related-note headings remain recognized.
- [x] Windows-style engine and vault paths are covered by automated tests.

## Post-release Repository Hardening

Added on 2026-07-17 without changing the published `1.13.0` install assets:

- [x] The current vendored engine tree is locked by
  `engine-provenance.json` and its aggregate digest.
- [x] The unresolved historical source commit is allowed only for `1.13.0`;
  every later release must record a full upstream core commit.

## Human/Directory Steps

- [x] Push the reviewed commit to the public repository's default branch.
- [x] Publish Git tag `1.13.0` and verify the attested GitHub release assets.
- [ ] Run an Obsidian Community dashboard preview scan against the release commit.
- [ ] Set the Community pricing label to **Optional payments**.
- [ ] Upload current light and dark product screenshots in the Community dashboard.
- [ ] Submit or update the Community listing after the automated scorecard passes.
