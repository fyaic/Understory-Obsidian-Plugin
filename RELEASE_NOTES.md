# Understory 1.8.1

Agent Access release for the Understory Obsidian plugin.

- Adds **Settings -> Understory -> AI agents** with MCP JSON, Skill prompt preview, copy buttons, local file creation, status checks, and safety copy.
- Adds Query-only and Agent memory model Skill modes so users can choose conservative lookup or proactive local context/memory behavior.
- Keeps install/enable non-disruptive: Understory stays on the plugin page and only shows a notice instead of opening the sidebar automatically.
- Improves Agent access readability with quote-style blocks for current vault identity and Agent install guidance.
- Renames **AI & privacy** to **Network & privacy** and reduces stacked callout blocks on that page.
- Renames and reorders relation tabs as **Relation discovery** -> **Relation maintenance** -> **AI agents**.
- Localizes Agent profile labels and install guidance in the Chinese Agent access UI and setup pack.
- Creates a local MCP server file at `.understory/agent/understory-mcp-server.js` so regular plugin users do not need a repository `scripts/` path.
- Saves the selected Understory Skill prompt to `.understory/agent/understory-skill.md`, binding agents to the current vault and use case.
- Adds local Vault-as-API read tools for capabilities, search, context packages, and note briefs.
- Keeps MCP local-only over stdio: no HTTP port, no Bondie Labs data upload, no full note bodies by default.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
