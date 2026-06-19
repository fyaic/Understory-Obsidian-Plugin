# Understory 1.7.1

Patch release for the Understory Obsidian plugin.

- Adds a local Agent API for automation, exposed through a JSON CLI and MCP stdio server without opening an HTTP port.
- Adds Agent API tools for status, relation reads, relation refresh, accept/reject, link insertion, and graph summary.
- Adds path safety, redacted JSON errors, and privacy documentation for Agent API CLI/MCP use.
- Fixes relation cache freshness checks to use the same 16-character SHA-256 format as the plugin store.
- Enables external CLI/MCP `refresh-relations` to run the local engine instead of acting as a dry-run-only validator.
- Keeps normal vault paths visible in successful API metadata while still redacting configured secrets.
- Adds a structured local engine diagnostics panel in Settings with plugin, engine, Python, path, script, dependency, permission, and vault `.understory` checks.
- Adds copyable, redacted diagnostic summaries and per-issue repair commands.
- Adds Agent API, CLI, MCP, safety, i18n, and engine-health smoke tests, including a guard that English strings do not contain Han characters.
- Defers vault event listeners and background startup work until the workspace layout is ready.
- Fixes inserted relation-section headings so English UI writes `## 🏷️ Related notes` instead of the legacy Chinese heading.
- Keeps compatibility with existing notes that already use `## 🏷️关联文件` or `## 关联文件`.
- Passes the plugin UI language to the local engine through `UNDERSTORY_UI_LANGUAGE`.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
