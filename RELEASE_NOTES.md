# Understory 1.13.2

Understory 1.13.2 is a Community-release quality update. The product flow is unchanged: sign in with Bondie, open a note, and generate suggestions without configuring an API key, endpoint, Python environment, or model provider.

## What Changed

- Release CI now builds `main.js` from the reviewable source instead of requiring a generated bundle in the repository.
- Two independent clean bundle builds must match byte-for-byte before GitHub attests and publishes the three install assets.
- Confirmation dialogs use Obsidian's modal title surface, while sidebar and conflict-section headings keep screen-reader semantics without raw heading elements.
- The public author link and English, Chinese, privacy, provenance, and release documentation are current.
- Hosted authentication, account state, note analysis, provider routing, local-engine behavior, and saved settings are unchanged.

## Verification

- Official Obsidian ESLint rules pass with zero warnings.
- All 101 automated tests pass.
- The deterministic bundle is rebuilt twice, compared byte-for-byte, and checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine smoke tests pass.
- Real Obsidian 1.12.7 smoke testing covers startup, account state, sidebar semantics, consent and logout dialogs, settings, and hosted suggestions without replacing local `data.json`.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should remain **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
