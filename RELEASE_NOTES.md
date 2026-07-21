# Understory 1.13.5

Understory 1.13.5 is a Community review polish update for Obsidian 1.13 settings search and the Obsidian 1.7.4 browser-feature audit. The product flow is unchanged: sign in with Bondie, open a note, and generate suggestions without configuring an API key, endpoint, Python environment, or model provider.

## What Changed

- Settings now implements `PluginSettingTab#getSettingDefinitions()` so Obsidian 1.13.0 and later can index Understory pages in settings search.
- The declarative settings page factory reuses the existing Account, Usage, Workflow, Scope, Suggestions, Activity, AI agents, and Advanced page renderers while preserving the legacy `display()` path for older Obsidian builds.
- CSS no longer uses `column-gap` or `text-decoration-thickness` in the conflict table, avoiding the browser-feature warnings reported against Obsidian 1.7.4.
- The bundled local-engine snapshot remains byte-identical to the attested 1.13.0 engine snapshot.
- Hosted authentication, account state, note analysis, provider routing, local-engine behavior, and saved settings are unchanged.

## Verification

- Official Obsidian ESLint rules plus the added type-aware CommonJS audit checks pass with zero warnings.
- All 102 automated tests pass.
- The deterministic bundle is rebuilt twice, compared byte-for-byte, and checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine smoke tests pass.
- The generated `main.js` includes only the settings-search compatibility and CSS audit-polish changes on top of the existing runtime behavior.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should remain **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
