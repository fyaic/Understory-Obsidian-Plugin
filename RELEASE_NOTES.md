# Understory 1.8.10

Patch release that fixes sidebar-only presentation mode for existing notes.

- When **Settings → Suggestions → Show suggestions in** is set to **Right sidebar only**, auto-generated related-note sections that were previously written to the note body are now removed on the next refresh.
- Manually inserted related-note sections are preserved; only sections created by Understory's auto-write path are stripped.
- New notes continue to respect the setting and do not receive an auto-generated section in sidebar-only mode.
- Rebuilds `main.js` and runs the full test suite and release checks.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`

---

# Understory 1.8.9

Patch release for Python path startup recovery.

- Repairs saved `pythonPath: "python"` when `python` is not executable but `python3` is available.
- Adds macOS/Homebrew Python discovery, including `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, and `/usr/bin/python3`.
- Updates setup copy so users know Understory can auto-detect `python3`, while still allowing explicit virtualenv paths.
- Keeps the self-contained bundled engine install path in `main.js`; release assets remain the standard Obsidian files.
- Adds release checks that fail if the bundled engine payload in `main.js` is stale.
- Runs the test suite and release check before publishing tagged releases.
