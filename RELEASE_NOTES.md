# Understory 1.13.1

Understory 1.13.1 is a focused interface-quality update for the hosted-first 1.13 release. The normal path remains unchanged: sign in with Bondie, open a note, and generate suggestions without configuring an API key, endpoint, Python environment, or model provider.

## What Changed

- Advanced diagnostics are now collapsed into a dedicated page section instead of rendering a long technical report by default.
- The duplicate local-engine health report was removed.
- Versions, paths, check groups, repair guidance, commands, and diagnostic actions now use a responsive, theme-aware layout.
- The Account, Usage, Workflow, Scope, Suggestions, Activity, AI agents, and right-sidebar workflows are unchanged.
- The bundled local engine is byte-identical to 1.13.0; this release records that inheritance without inventing an upstream commit.

## Verification

- Official Obsidian ESLint rules pass with zero warnings.
- All 100 automated tests pass.
- The deterministic bundle is rebuilt and checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine smoke tests pass.
- Real Obsidian 1.12.7 smoke testing covers Bondie login, account identity, hosted suggestions and risks, account-attributed usage, all settings pages, and the collapsed Advanced layout.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should remain **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
