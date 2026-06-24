# Understory 1.8.4

Patch release for right-sidebar-only plugin behavior.

- Keeps Understory quiet on startup; it does not auto-open a sidebar by default.
- Opens Understory only in the right sidebar when users click the ribbon icon, command palette action, or settings action.
- Avoids reusing stale Understory panes that Obsidian may have restored outside the right sidebar, and removes those stale panes when opening the right-sidebar view.
- Keeps the self-contained bundled engine install path and the `1.8.3` engine refresh fixes.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
