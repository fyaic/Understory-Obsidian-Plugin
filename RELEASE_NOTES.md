# Understory 1.8.9

Patch release for Python path startup recovery.

- Repairs saved `pythonPath: "python"` when `python` is not executable but `python3` is available.
- Adds macOS/Homebrew Python discovery, including `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, and `/usr/bin/python3`.
- Updates setup copy so users know Understory can auto-detect `python3`, while still allowing explicit virtualenv paths.
- Keeps the self-contained bundled engine install path in `main.js`; release assets remain the standard Obsidian files.
- Adds release checks that fail if the bundled engine payload in `main.js` is stale.
- Runs the test suite and release check before publishing tagged releases.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
