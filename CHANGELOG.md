# Changelog

## 1.8.7

- Return structured `warnings` and `fixes` when the Embedding cache is missing, including the command-palette action and CLI command to build the index.
- Show a localized Obsidian notice when relation discovery falls back to local keyword recall because the Embedding index has not been built.
- Propagate engine guidance through both command execution and right-sidebar refresh paths.

## 1.8.6

- Fix `refresh-link` in Full/Vector mode when the embedding cache has not been created yet; Understory now falls back to local keyword recall instead of exiting with code 1.
- Surface Python JSON error details in plugin diagnostics when the engine process exits non-zero.
- Add CLI coverage for the missing-cache refresh fallback.

## 1.8.5

- Fix `api.py init` in Local-only mode so it exits successfully after intentionally skipping cloud embedding indexing.
- Add CLI coverage for the Local-only `api.py init` path.
- Add release checks that verify key engine file hashes are embedded in `main.js`.
- Rebuild `main.js` with the corrected bundled engine payload.

## 1.8.1

- Localize Agent profile labels and install guidance in the Chinese Agent access settings UI and setup pack.
- Finalize the Agent Access release metadata for `manifest.json`, `package.json`, `versions.json`, `CHANGELOG.md`, and `RELEASE_NOTES.md`.

## 1.8.0

- Add an **AI agents** settings tab that pairs MCP configuration with the matching Understory Skill.
- Add two Understory Skill usage modes: Query-only for explicit vault lookup and Agent memory model for proactive local context and memory maintenance.
- Add copy/create/check actions for Agent access, including local MCP server file creation at `.understory/agent/understory-mcp-server.js`.
- Add Understory Skill prompt generation and save-to-vault support at `.understory/agent/understory-skill.md`, binding agents to the selected vault and usage mode.
- Keep plugin enablement non-disruptive: Understory no longer opens the sidebar or steals focus from the plugin README/settings flow during startup.
- Refine the Agent access settings layout with quote-style blocks for current vault identity and Agent install guidance.
- Rename **AI & privacy** to **Network & privacy** and simplify the page layout so network/model notes read as lightweight text instead of stacked callout blocks.
- Rename settings tabs to **Relation discovery** and **Relation maintenance**, keeping those relation workflow pages adjacent before **AI agents**.
- Add Vault-as-API read tools for capabilities, local keyword/relations search, scoped context packages, and note briefs.
- Extend JSON CLI and MCP stdio server with the new read tools while keeping responses scoped to snippets and relationship metadata.
- Update Agent API, README, Chinese README, and privacy documentation for the local-only MCP/Skill workflow.
- Add tests for Agent access generation, settings UI, CLI, MCP, and local context retrieval.

## 1.7.2

- Add `package-lock.json` for Obsidian build verification reproducibility.
- No functional plugin changes from 1.7.1.

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
