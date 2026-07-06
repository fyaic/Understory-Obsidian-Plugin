# Understory 1.8.11

Patch release that makes the default suggestion experience sidebar-only and reduces first-run setup friction.

- New installs default to **Settings -> Suggestions -> Show suggestions in: Right sidebar only**.
- Relation refresh now uses `--no-auto-write` by default, so Understory does not automatically write related-note sections into note bodies unless the user chooses a note-body presentation mode.
- Sidebar-only presentation also suppresses default conflict-block writes.
- Existing sidebar-only refreshes continue to strip old auto-generated related-note sections while preserving manually inserted sections.
- Semantic setup is lighter: the setup card uses one primary check flow, shows progress when a vector model/index action starts, and keeps local-only vector configuration secondary.
- The right sidebar now stacks relation action buttons vertically so long file titles have room to breathe.
- Adds regression coverage for the sidebar-only default and rebuilds `main.js` with the updated bundled engine.

Release assets:

- `manifest.json`
- `main.js`
- `styles.css`
