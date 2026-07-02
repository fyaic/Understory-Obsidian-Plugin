# Understory 1.8.7

Patch release for missing embedding-index recovery.

- Guides users to build the Embedding index when semantic recall is unavailable, instead of surfacing only `api.py exited with code 1`.
- Keeps `refresh-link` usable when the embedding cache has not been created yet by returning local keyword fallback results with structured `warnings` and `fixes`.
- Shows a localized Obsidian notice that points to the `Prepare local search index` command.
- Keeps the self-contained bundled engine install path in `main.js`; release assets remain the standard Obsidian files.
- Adds release checks that fail if the bundled engine payload in `main.js` is stale.
- Runs the test suite and release check before publishing tagged releases.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
