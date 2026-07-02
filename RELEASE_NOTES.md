# Understory 1.8.8

Patch release for local engine startup recovery.

- Repairs invalid saved or environment-provided engine paths by switching back to the bundled engine extracted from the release.
- Makes the settings-page default engine action prefer the bundled release engine, so users do not stay stuck on a stale local path.
- Keeps the 1.8.7 missing Embedding-index fallback and guidance behavior.
- Keeps the self-contained bundled engine install path in `main.js`; release assets remain the standard Obsidian files.
- Adds release checks that fail if the bundled engine payload in `main.js` is stale.
- Runs the test suite and release check before publishing tagged releases.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
