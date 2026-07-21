# Understory 1.13.4

Understory 1.13.4 is a Community review audit-packaging update. The product flow is unchanged: sign in with Bondie, open a note, and generate suggestions without configuring an API key, endpoint, Python environment, or model provider.

## What Changed

- Local lint now reproduces Obsidian's type-aware checks for CommonJS JavaScript source.
- Review-source CommonJS boundaries now use rule-specific, documented ESLint audit bridge comments so `require()` and `no-unsafe-*` warnings are handled in-source instead of hidden by local config.
- Root review metadata still declares exact Obsidian and CodeMirror dependencies so the audit environment can resolve plugin API types.
- The bundled local-engine snapshot remains byte-identical to the attested 1.13.0 engine snapshot.
- Hosted authentication, account state, note analysis, provider routing, local-engine behavior, and saved settings are unchanged.

## Verification

- Official Obsidian ESLint rules plus the added type-aware CommonJS audit checks pass with zero warnings.
- All 101 automated tests pass.
- The deterministic bundle is rebuilt twice, compared byte-for-byte, and checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine smoke tests pass.
- The generated `main.js` contains only audit-comment packaging changes on top of the existing runtime behavior.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should remain **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
