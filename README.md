# Understory

![Understory hero](assets/understory-hero.png)

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
| Local only | No cloud model or webhook requests. Understory uses local files, keywords, ER data, existing caches, and reports. |
| Vector model only | Sends selected snippets/titles to the vector provider you configure for similarity analysis. No reasoning model is used. |
| Full AI analysis | Allows both vector and reasoning model requests for semantic indexing, concept extraction, explanations, and conflict checks. |

Optional cloud features can use OpenAI, Zhipu, or a custom OpenAI-compatible endpoint. You provide your own API keys. Bondie Labs does not receive or manage your notes, prompts, embeddings, responses, logs, or API keys.

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

You can also set the engine folder and Python path inside the Understory settings page. After changing system environment variables, restart Obsidian so the desktop app can read them.

## First Run

1. Open **Settings -> Understory**.
2. Click **Check settings** to confirm the local engine and Python are available.
3. Keep **Network mode** on **Local only**, or explicitly choose a cloud mode and configure your own provider key.
4. Open the command palette and run **Show Understory**.

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

The release tag must match `manifest.json` version exactly, for example `1.7.0`.

## Links

- Website: https://bondie.io/research/understory
- Core engine: https://github.com/fyaic/Understory-graphify-engine
- Privacy: [PRIVACY.md](PRIVACY.md)
