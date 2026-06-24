# Understory 1.8.2

Self-contained engine release for the Understory Obsidian plugin.

- Bundles the local Understory engine in this repository under `understory-graphify-engine/`.
- Embeds the engine payload into the release `main.js`, so standard Obsidian installs using `manifest.json`, `main.js`, and `styles.css` can extract the engine on first load.
- Defaults new installs to the bundled engine path inside the plugin folder instead of asking users to locate an engine directory.
- Preserves explicit user engine overrides when a saved or environment-provided engine path is present.
- Adds Kimi/Moonshot reasoning presets:
  - `kimi-cn`: `https://api.moonshot.cn/v1`, model `kimi-k2.5`
  - `kimi-global`: `https://api.moonshot.ai/v1`, model `kimi-k2.5`
- Updates English and Chinese settings copy for bundled engine setup and provider fields.
- Strengthens release checks so builds fail if required engine files are missing or the built `main.js` does not include the bundled engine payload.
- Updates privacy copy to disclose local engine extraction into the plugin folder.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
