# Changelog

## 1.7.1

- Add a local Agent API for automation through a JSON CLI and MCP stdio server.
- Add Agent API support for status, relation reads, relation refresh, accept/reject, link insertion, and graph summary.
- Add Agent API path safety, redacted JSON errors, and privacy documentation.
- Fix relation cache freshness checks to match the plugin store's 16-character SHA-256 hash format.
- Enable external CLI/MCP `refresh-relations` to run the local engine.
- Keep normal vault paths visible in successful API metadata while still redacting configured secrets.
- Add a structured local engine diagnostics panel in Settings with version, path, script, dependency, permission, and vault `.understory` checks.
- Add copyable, redacted diagnostic summaries and per-issue repair commands.
- Add Agent API, CLI, MCP, safety, i18n, and engine-health smoke tests, including a guard that English strings do not contain Han characters.
- Defer vault event listeners and background startup work until the workspace layout is ready.
- Fix inserted relation-section headings so English UI writes `## 🏷️ Related notes`.
- Preserve compatibility with legacy Chinese relation sections.
- Pass UI language to the local engine through `UNDERSTORY_UI_LANGUAGE`.

## 1.7.0

Initial public release package for the standalone Understory Obsidian plugin repository.

- Adds the Show Understory right sidebar.
- Adds local/vector/full privacy modes.
- Adds English and Chinese UI support.
- Adds user-configurable OpenAI, Zhipu, and custom OpenAI-compatible provider settings.
- Adds local engine health checks.
- Adds Obsidian release artifacts at the repository root.
