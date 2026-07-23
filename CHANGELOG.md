# Changelog

## 1.13.10

- Remove provider/model metadata from sanitized hosted capability config.
- Stop persisting server-selected model names or injecting model variables into
  the hosted runtime; advanced local/self-hosted model settings remain intact.
- Align hosted account copy with the login-only experience so ordinary users
  see service readiness rather than implementation-layer routing details.
- Add regressions proving hostile provider/model metadata is discarded and
  hosted Python environments contain no model selection.
- Preserve the byte-identical, attested 1.13.0 local-engine snapshot.

## 1.13.9

- Show a compact current-note notice when a configured refresh scope excludes
  the note's folder.
- Explain that manual analysis remains available while full-vault and
  scheduled refreshes skip that folder.
- Add a direct path from the sidebar notice to Scope settings and share one
  normalized path-matching rule with the refresh queue.
- Preserve hosted authentication, analysis APIs, saved settings, and the
  byte-identical attested 1.13.0 local-engine snapshot.

## 1.13.8

- Add full-window DemoVault screenshots for the Understory Suggestions and Risks sidebar to the English and Chinese README.
- Remove redundant fenced text demos from the README now that the screenshots provide the concrete walkthrough.
- Preserve hosted authentication, note analysis, provider routing, local-engine behavior, UI behavior, saved settings, and the inherited 1.13.0 local-engine snapshot.

## 1.13.7

- Remove unused catch bindings reported by automated review recommendations across source modules by using `catch { ... }` for intentionally ignored failures.
- Keep catch parameters only where the error object is used for diagnostics, logging, or returned failure details.
- Tighten local ESLint so unused caught errors are checked before release.
- Preserve hosted authentication, note analysis, provider routing, local-engine behavior, UI behavior, saved settings, and the inherited 1.13.0 local-engine snapshot.

## 1.13.6

- Replace the npm `build` entrypoint with a Node-based bundle generator so Obsidian clean build verification no longer requires a `python` command.
- Switch deterministic bundle verification to the same Node bundler used by `npm run build`.
- Add release-script regression coverage and release-check guards that prevent the build script from drifting back to a Python-only command.
- Preserve hosted authentication, note analysis, provider routing, local-engine behavior, UI behavior, saved settings, and the inherited 1.13.0 local-engine snapshot.

## 1.13.5

- Add `PluginSettingTab#getSettingDefinitions()` support so Obsidian 1.13.0 and later can include Understory settings pages in settings search.
- Reuse the existing settings page renderers from both the new declarative `SettingPage` path and the legacy `display()` path for older supported Obsidian builds.
- Replace the conflict-table CSS `column-gap` usage and remove `text-decoration-thickness` to avoid Obsidian 1.7.4 browser-feature audit warnings.
- Preserve hosted authentication, note analysis, provider routing, local-engine behavior, UI behavior, saved settings, and the inherited 1.13.0 local-engine snapshot.

## 1.13.4

- Add type-aware local lint coverage for Obsidian Community audit warnings around CommonJS `require()` and `no-unsafe-*` rules.
- Add rule-specific, documented ESLint audit bridge comments to CommonJS source, scripts, and Node test harness files so review checks do not surface false unsafe warnings from JavaScript module boundaries.
- Preserve hosted authentication, note analysis, provider routing, local-engine behavior, UI behavior, saved settings, and the inherited 1.13.0 local-engine snapshot.

## 1.13.3

- Make release asset generation platform-stable across Windows and Linux by sorting modules and bundled engine files with explicit string keys.
- Normalize bundled engine text payloads to LF before hashing and packaging, so local verification matches GitHub Actions and Git blob provenance.
- Add repository text/binary attributes to keep release inputs stable without tracking the generated `main.js`.
- No hosted authentication, note analysis, provider routing, local-engine behavior, UI behavior, or saved settings changed.

## 1.13.2

- Build `main.js` from reviewable source during CI and release publishing instead of tracking the generated bundle in the repository.
- Verify bundle reproducibility with two independent clean builds before release assets are attested.
- Replace raw UI heading elements with Obsidian modal titles and explicit ARIA heading semantics without changing the visual hierarchy.
- Repair the public author URL and align English, Chinese, privacy, provenance, and release documentation with the current Community review rules.
- Reuse the byte-identical attested 1.13.0 local-engine snapshot; hosted login and analysis contracts are unchanged.

## 1.13.1

- Keep local-engine and connection diagnostics collapsed under Advanced so ordinary users never land in a wall of technical status text.
- Remove the duplicate engine-health rendering and give versions, paths, checks, fixes, commands, and action controls a responsive diagnostic layout.
- Add regression coverage for the Advanced disclosure hierarchy and its required stylesheet contract.
- Reuse the byte-identical attested 1.13.0 local-engine snapshot with an explicit inherited-provenance gate; no engine runtime files changed.

## 1.13.0

- Make Bondie sign-in and the managed Understory service the default path for new installs. New users no longer see provider keys, endpoints, Python, or engine setup before they can use the plugin.
- Add the complete SynapseHub product session flow: browser login, Obsidian protocol callback, session exchange, product-only logout, separately confirmed global logout, account switching, and account-center links.
- Add account identity, fallback avatars, Free/Pro/Plus membership states, service readiness, and profile/security/device entries managed by Bondie.
- Add per-account usage totals and feature-level request/processing-unit activity from the hosted service.
- Add hosted relation discovery, risk analysis, principle extraction, and bounded vault semantic review with explicit selected-snippet consent and server-managed provider credentials.
- Redesign settings into Account, Usage, Workflow, Scope, Suggestions, Activity, AI agents, and Advanced pages. Disconnected users see a single Bondie sign-in action.
- Redesign the right sidebar around the current note, account state, Suggestions/Risks tabs, friendly match percentages, localized severity, and bounded error reporting.
- Preserve existing local/self-hosted/BYOK and Agent/MCP workflows under Advanced. Existing saved local mode remains local after upgrade.
- Prevent duplicate startup work and notification storms, filter hidden/configuration paths, and keep background failures redacted and bounded.
- Replace the stale hardcoded bundle list with automatic source-module discovery so all hosted modules are included in `main.js`.
- Add official Obsidian linting, hosted integration regressions, deterministic release checks, updated privacy/payment disclosures, and real Obsidian hosted-flow smoke coverage.

## 1.8.11

- Make new installs default to **Show suggestions in: Right sidebar only**, so relation refresh uses `--no-auto-write` unless the user chooses a note-body presentation mode.
- Keep sidebar-only presentation from writing conflict blocks or related-note sections into note bodies by default.
- Add regression coverage proving the default relation refresh path uses `--no-auto-write` and strips old auto-generated related-note sections in sidebar-only mode.
- Polish the setup and relation UI: semantic setup now has a single primary flow with progress feedback, local-only vector configuration is secondary, and sidebar action buttons stack vertically so file titles get more room.

## 1.8.10

- Respect the **Show suggestions in: Right sidebar only** setting for existing notes: auto-generated related-note sections are now stripped from the note body when the presentation mode is sidebar-only, while manually inserted sections are preserved.
- Align the bundled Understory Skill with the MCP-based Agent setup: add the business knowledge-map workflow, ship a reusable template, and remove author-machine vault path assumptions from exported engine guidance.
- Add guided embedding onboarding: semantic index readiness is shown separately from local engine readiness, settings expose configure/build actions, and missing-index keyword fallback points users back to setup.
- Annotate Agent API and MCP relation targets with `targetStatus`, `targetExists`, `resolvedTarget`, and diagnostics so moved or missing cached paths are reported without rewriting `.understory/relations.json`.

## 1.8.9

- Auto-repair a saved `pythonPath` of `python` when that command is unavailable and `python3` can be found.
- Add macOS/Homebrew Python discovery for `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, and `/usr/bin/python3`.
- Update setup copy and regression tests for Python path recovery.

## 1.8.8

- Repair invalid saved or environment-provided engine paths by switching back to the bundled engine extracted from the release.
- Prefer the bundled release engine for the settings-page default engine action and Agent access engine path.
- Add regression coverage for invalid engine path recovery.

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
