# Understory

<p align="center">
  <img src="assets/understory-logo.png" alt="Understory leaf mark" width="150">
</p>

<p align="center">
  Find related notes, surface conflicts, and keep a growing vault easier to navigate.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

Understory is a desktop knowledge-maintenance companion. Open a note, ask Understory to analyze it, then review related-note suggestions and risks in a focused right sidebar.

The standard experience is hosted-first. Sign in with a Bondie account and Understory prepares the managed AI service automatically. You do not need to choose a provider, paste a model key, install Python, or configure an endpoint.

## Start In Three Steps

1. Enable Understory and click the leaf icon in the ribbon.
2. Select **Continue with Bondie** and complete sign-in in your browser.
3. Return to your note and select **Generate suggestions**.

The first analysis asks for permission before selected note snippets leave your device. Understory then shows suggestions and risks without changing the note body. You decide whether to accept, ignore, or insert a confirmed relation.

## What You Get

- A right sidebar organized into **Suggestions** and **Risks**.
- Related-note matches grouped by topic or source.
- Conflict, stale-content, orphan-note, and broken-link checks.
- A clear account page with profile, membership, and service readiness.
- Per-account usage totals and feature-level activity.
- Folder scope controls for notes that should be included or ignored.
- English and Chinese interfaces, with light and dark theme support.
- An advanced local Agent API through JSON CLI and MCP stdio.

## Account And Membership

Bondie manages sign-in, profile changes, account security, connected devices, and account recovery. The plugin provides direct entries to those account pages instead of duplicating identity settings.

Understory currently assigns every account the **Free** membership. The client already understands Free, Pro, and Plus membership states so future plans can be introduced without exposing billing controls before they are ready.

Signing out of Understory revokes this product session only. A separate, clearly confirmed action signs out of the wider Bondie account.

## Hosted AI, Without Client Keys

In the standard hosted mode:

- Model credentials are managed by the Understory service and are never returned to the plugin.
- Each signed-in account receives server-managed provider access.
- The service records account-linked request and processing-unit totals for quotas, reliability, and operator observability.
- The plugin displays the account's aggregate usage without exposing provider credentials or internal routing.

The current managed service uses server-side provider routing. Provider pools and upstream credentials can change without requiring users to reconfigure the plugin.

## Privacy At A Glance

Understory reads Markdown notes in the current vault. Hosted analysis can send note paths, titles, and bounded text snippets to `https://understory.bondie.io` only after consent. Current limits include up to 4,000 characters for the active note and up to 2,000 characters for each selected candidate during relation discovery.

The server returns relations, scores, risk summaries, and usage data. The client stores the session, settings, relation cache, and analysis reports locally. Hosted responses state that note content is not retained by the Understory service; account and usage records are retained as required to operate the service.

You can exclude folders, disable selected-snippet uploads, sign out, or switch an existing advanced installation to a local/self-hosted workflow. See [PRIVACY.md](PRIVACY.md) for the complete data-flow matrix.

## Advanced Local And Self-Hosted Workflows

Existing users who already selected local mode stay in local mode after upgrading. Advanced settings also retain local, self-hosted, and bring-your-own-key workflows for operators who intentionally need them.

Those workflows may require:

- Obsidian desktop.
- Python and the bundled local engine.
- A provider account and key for optional vector or reasoning services.
- Manual endpoint, model, and privacy configuration.

These controls live under **Settings -> Understory -> Advanced**. They are not part of the first-run path. Local mode blocks managed hosted discovery and does not require a Bondie session.

## AI Agents

Understory can expose the current vault to a local agent through MCP stdio. It does not open an HTTP port. From **Settings -> Understory -> AI agents**, you can:

- Create a vault-specific MCP server file in `.understory/agent`.
- Copy a vault-specific MCP configuration.
- Choose a conservative query-only prompt or an agent-memory workflow.
- Export a local setup pack and redacted diagnostics.

Read tools return scoped snippets and relation metadata rather than full note bodies by default. Write tools modify local vault files and should be used only after user confirmation. See [docs/AGENT_API.md](docs/AGENT_API.md) for the complete contract.

## Local Files

Understory may write these local artifacts:

```text
<vault>/.understory/                         relation cache, reports, logs, Agent files
<vault>/.obsidian/plugins/understory/data.json
                                             plugin settings and the product session
<vault>/.obsidian/plugins/understory/understory-graphify-engine/
                                             bundled engine for advanced local mode
```

Normal hosted use does not start the Python engine.

## Installation

### Community Directory

After the Community listing is approved:

1. Open **Settings -> Community plugins -> Browse**.
2. Search for **Understory**.
3. Install and enable it.

### Manual Release Install

Download `manifest.json`, `main.js`, and `styles.css` from the same GitHub release. Place them in:

```text
<vault>/.obsidian/plugins/understory/
```

Restart Obsidian, then enable Understory under **Community plugins**. Do not mix assets from different versions.

## Troubleshooting

### The browser says sign-in succeeded but the plugin is still disconnected

Return to the same vault, open Understory, and select **Refresh status**. If the callback was opened by another vault or profile, start sign-in again from the intended vault.

### Suggestions do not run

Confirm that:

- The account page says **Connected** and **Service ready**.
- A Markdown note is active.
- Snippet upload consent is enabled.
- The note is not inside an excluded folder.

### A session expired

Understory clears an invalid local session after an unauthorized server response. Sign in again; the relation cache in `.understory` remains local.

### Local mode is unavailable

Open **Advanced**, run the local setup check, and review Python, engine path, dependency, and permission guidance. Hosted users do not need this setup.

## Payment Status

Community listing: **Optional payments**.

Understory is free to install and the current hosted membership is Free. It connects to a managed service and retains advanced workflows that can connect to paid APIs, so Obsidian's policy requires the Optional payments label even while checkout is disabled.

## Development

The reviewable source lives in `src/`; release assets live at the repository root.
The bundled local-engine snapshot is locked by `engine-provenance.json`. Every
release after `1.13.0` must identify the exact upstream core commit from
`fyaic/Understory-graphify-engine`.

```bash
npm ci
npm run verify
```

`npm run verify` runs the official Obsidian lint rules, 99 automated tests, the deterministic bundle, release metadata checks, a bundle syntax check, and a local engine smoke test.

Every release must attach exactly these install assets:

- `manifest.json`
- `main.js`
- `styles.css`

The Git tag must exactly match the manifest version. Current release: `1.13.0`.

## License

Understory is source-available under the [PolyForm Perimeter License 1.0.0](LICENSE). See [NOTICE](NOTICE) for the required notice and commercial licensing contact.
