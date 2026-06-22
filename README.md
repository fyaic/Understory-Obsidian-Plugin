# Understory

<p align="center">
  <img src="assets/understory-logo.png" alt="Understory logo" width="220">
</p>

[Chinese README](README.zh-CN.md) | [Website](https://bondie.io/research/understory) | [Privacy](PRIVACY.md)

Understory is a local-first knowledge layer for Obsidian. It builds a private maintenance layer under your vault, driven by Vector, ER, and Graph analysis, so related notes, claims, concepts, conflicts, and orphan pages can be discovered and maintained over time.

The plugin is desktop-only and works with the local Understory engine. It is designed for people who want Obsidian to keep a durable, self-refreshing memory layer without sending vault data to a developer-operated service.

## What It Does

- Shows related-note suggestions in the right sidebar through **Show Understory**.
- Discovers note relationships with hybrid signals, including local structure, entity facts, graph analysis, and optional model-powered semantic signals.
- Flags possible conflicts, stale notes, orphan pages, and broken knowledge paths.
- Maintains local reports and caches in `.understory`.
- Supports English and Chinese UI text from the plugin settings.
- Lets you choose a privacy mode before configuring any model provider.

## Privacy Modes

Understory starts local-first.

| Mode | What happens |
| :--- | :--- |
| Local only | No cloud model or webhook requests. Provider keys are not passed to the local engine process. Understory uses local files, keywords, ER data, existing caches, and reports. |
| Vector model only | Sends selected snippets/titles to the vector provider you configure for similarity analysis. No reasoning model is used. |
| Full AI analysis | Allows both vector and reasoning model requests for semantic indexing, concept extraction, explanations, and conflict checks. |

Optional cloud features can use OpenAI, Zhipu, or a custom OpenAI-compatible endpoint. You provide your own API keys. Bondie Labs does not receive or manage your notes, prompts, embeddings, responses, logs, or API keys.

The **Network & privacy** settings page lets you choose a provider, paste your API key, and edit the endpoint/base URL and model name. OpenAI and Zhipu presets fill the common endpoints for you, but custom proxies and compatible services are supported.

Plugin logs and short diagnostics redact known API keys, bearer tokens, webhook URLs, and similar secrets. Raw process stdout is not stored in plugin logs by default.

Payment status: **Optional payments**. The plugin is free to install. Local mode does not require an API key. Provider accounts, API keys, pricing, quotas, privacy terms, and billing are controlled by the provider you choose.

## Requirements

- Obsidian desktop app.
- The local Understory engine.
- Python available on your machine.

The plugin is marked `isDesktopOnly` because it uses local files, Node APIs, and a Python subprocess.

## Manual Install

Until the plugin is accepted into the Obsidian Community directory, install it manually from the latest GitHub release.

1. Download these release assets:
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. Create this folder in your vault:

   ```text
   <Your Vault>/.obsidian/plugins/understory/
   ```

3. Put the three downloaded files into that folder.
4. Restart Obsidian.
5. Enable **Understory** in **Settings -> Community plugins**.

## Engine Setup

Understory for Obsidian is the plugin shell. The local engine is maintained separately:

```powershell
git clone https://github.com/fyaic/Understory-graphify-engine.git
cd Understory-graphify-engine
python -m pip install -r requirements.txt
```

Set the engine path before launching Obsidian:

```powershell
$env:UNDERSTORY_ENGINE_DIR="C:\path\to\Understory-graphify-engine"
$env:UNDERSTORY_PYTHON_PATH="python"
```

You can also set the engine folder and Python path in **Settings -> Understory -> Start here**. After changing system environment variables, restart Obsidian so the desktop app can read them.

The settings page is split into tabs. Most users only need **Start here**, **Network & privacy**, **Relation discovery**, and **Relation maintenance**. **AI agents** comes after the relation workflow, so first-run setup stays focused on the required steps.

The **Check setup** button checks the local engine, Python, scripts, vault `.understory` deployment, and permissions. Each problem includes a suggested fix and, when useful, a command you can copy. The panel does not run `pip install`, `git pull`, or other repair commands automatically.

Common manual fixes:

```powershell
python -m pip install -r "C:\path\to\Understory-graphify-engine\requirements.txt"
$env:UNDERSTORY_ENGINE_DIR="C:\path\to\Understory-graphify-engine"
$env:UNDERSTORY_PYTHON_PATH="python"
```

Use **Copy diagnostics** when you need to share setup details with a maintainer. The copied summary is designed to exclude API keys, webhook URLs, and vault note content.

## First Run

1. Open **Settings -> Understory**.
2. In **Start here**, choose the local Understory engine folder and confirm Python.
3. Click **Check setup**.
4. In **Network & privacy**, keep **Network mode** on **Local only**, or explicitly choose a cloud mode and configure your own provider key, endpoint/base URL, and model name.
5. In **AI agents**, create the local MCP server file, copy the MCP JSON into your agent's MCP settings, and copy the matching Skill prompt if you want an external agent to use this vault as a local knowledge API.
6. Open the command palette and run **Show Understory**.

## Agent API

Understory also exposes a local Agent API for automation. It is not an HTTP server and does not open a port. Agents can call it through a JSON CLI or an MCP stdio server.

For regular Obsidian plugin users, open **Settings -> Understory -> AI agents**. That page provides:

- A copyable, vault-specific MCP JSON configuration with a server key such as `understory-work-notes`.
- A local MCP server file created at `.understory/agent/understory-mcp-server.js`; this is not a cloud server and does not open an HTTP port.
- A use-case selector for **Query-only** or **Agent memory model**.
- Agent-specific setup notes for Generic MCP, Codex, Claude Desktop, Cursor, and OpenClaw.
- A copyable Skill prompt that binds the agent to this vault and the selected use case.
- A setup pack that combines the MCP config, Skill, vault identity, and install notes.
- A local diagnostics summary that is designed to avoid API keys, webhook URLs, and vault note content.

Understory identifies only the currently open vault. If you use multiple Obsidian vaults, repeat this flow in each vault and add each generated MCP server entry to your agent config. Do not reuse a single global `understory` key for every vault.

The Skill has two variants:

- **Query-only**: the agent calls Understory only when you explicitly ask it to query, search, cite, summarize, or inspect this vault. This mode is read-only and conservative.
- **Agent memory model**: the agent treats Understory as active local context and a long-term memory layer. For relevant ongoing work, it can retrieve context before planning and propose durable memory or relation updates at the end, but local writes still require user confirmation.

Developer commands are still available from this repository:

```powershell
node scripts/understory-agent-cli.js status --vault "C:\path\to\vault" --json
node scripts/understory-agent-cli.js get-relations --vault "C:\path\to\vault" --note "Notes/A.md" --json
node scripts/understory-agent-cli.js refresh-relations --vault "C:\path\to\vault" --note "Notes/A.md" --engine-dir "C:\path\to\Understory-graphify-engine" --json
node scripts/understory-agent-cli.js insert-relation --vault "C:\path\to\vault" --note "Notes/A.md" --target "Notes/B.md" --title "B" --json
```

Multi-vault MCP configuration example after using **Create local MCP server file** in each vault:

```json
{
  "mcpServers": {
    "understory-work-notes": {
      "command": "node",
      "args": [
        "C:/path/to/work-vault/.understory/agent/understory-mcp-server.js",
        "--vault",
        "C:/path/to/work-vault",
        "--engine-dir",
        "C:/path/to/Understory-graphify-engine"
      ]
    },
    "understory-research-vault": {
      "command": "node",
      "args": [
        "C:/path/to/research-vault/.understory/agent/understory-mcp-server.js",
        "--vault",
        "C:/path/to/research-vault",
        "--engine-dir",
        "C:/path/to/Understory-graphify-engine"
      ]
    }
  }
}
```

Developers working from this repository can use `scripts/understory-mcp-server.js` instead of the exported server path.

All Agent API responses use a JSON envelope with `ok`, `data`, `error`, and `meta`. The API keeps paths inside the selected vault, does not return full note bodies by default, and reuses Understory secret redaction. See [docs/AGENT_API.md](docs/AGENT_API.md) for the full tool contract.

Current MCP read tools include status, capabilities, graph summary, note relations, local keyword/relations search, scoped context packages, and note briefs. Write tools remain local-only and should be used only after user confirmation.

## Build From Source

This repository keeps the reviewable plugin source in `src/` and the Obsidian release files at the repository root.

```powershell
npm run build
npm run check
```

The build script bundles `src/*.js` into root `main.js`.

## Release Files

Each GitHub release must attach:

- `manifest.json`
- `main.js`
- `styles.css`

The release tag must match `manifest.json` version exactly, for example `1.8.1`.

## Links

- Website: https://bondie.io/research/understory
- Core engine: https://github.com/fyaic/Understory-graphify-engine
- Privacy: [PRIVACY.md](PRIVACY.md)
