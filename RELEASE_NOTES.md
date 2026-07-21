# Understory 1.13.3

Understory 1.13.3 is a release-packaging stability update. The product flow is unchanged: sign in with Bondie, open a note, and generate suggestions without configuring an API key, endpoint, Python environment, or model provider.

## What Changed

- Local Windows builds and GitHub Actions builds now produce byte-identical release assets.
- The bundler sorts source modules and bundled engine files with platform-stable string keys.
- Bundled engine text payloads are normalized to LF before hashing and packaging, matching Git's release snapshot.
- Repository text checkout rules now keep release inputs LF-normalized while preserving binary assets.
- Hosted authentication, account state, note analysis, provider routing, local-engine behavior, and saved settings are unchanged.

## Verification

- Official Obsidian ESLint rules pass with zero warnings.
- All 101 automated tests pass.
- The deterministic bundle is rebuilt twice, compared byte-for-byte, and checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine smoke tests pass.
- The generated `main.js` matches the already-attested 1.13.2 runtime bundle byte-for-byte.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should remain **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
