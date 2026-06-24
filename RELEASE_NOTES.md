# Understory 1.8.3

Patch release for the self-contained engine install.

- Fixes Agent/MCP refresh runs by passing the vault path explicitly to the bundled `api.py` engine.
- Treats normal engine `skipped` responses, such as unchanged notes, as successful no-op refreshes instead of surfacing an engine failure.
- Excludes `.obsidian`, `.understory`, `.trash`, and other internal folders from bundled engine markdown scans.
- Cleans old relation cache entries that pointed at plugin-internal markdown files after users upgrade from `1.8.2`.
- Keeps the self-contained bundled engine install path introduced in `1.8.2`; users still only need the three standard Obsidian release assets.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
