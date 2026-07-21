# Understory 1.13.6

Understory 1.13.6 is a Community review build-compatibility update. The product flow is unchanged: sign in with Bondie, open a note, and generate suggestions without configuring an API key, endpoint, Python environment, or model provider.

## What Changed

- `npm run build` now uses a Node-based bundler, so Obsidian's clean build verification no longer depends on a `python` command being present.
- Deterministic bundle verification now validates the same Node bundler used by the npm build entrypoint.
- Release checks now fail if the npm build script regresses to a Python-dependent command.
- The bundled local-engine snapshot remains byte-identical to the attested 1.13.0 engine snapshot.
- Hosted authentication, account state, note analysis, provider routing, local-engine behavior, and saved settings are unchanged.

## Verification

- Official Obsidian ESLint rules plus the added type-aware CommonJS audit checks pass with zero warnings.
- All 103 automated tests pass.
- The deterministic bundle is rebuilt twice, compared byte-for-byte, and checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine smoke tests pass.
- The generated `main.js` is built by the Node bundler and includes only build-packaging compatibility changes on top of the existing runtime behavior.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should remain **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
