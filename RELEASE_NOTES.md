# Understory 1.13.8

Understory 1.13.8 refreshes the public README with real DemoVault screenshots of the Suggestions and Risks sidebar. The product flow is unchanged: sign in with Bondie, open a note, and generate suggestions without configuring an API key, endpoint, Python environment, or model provider.

## What Changed

- Added full-window Obsidian screenshots showing grouped related-note suggestions and the risk review queue in a demo vault.
- Removed redundant fenced text demos from the English and Chinese README now that the screenshots carry the walkthrough.
- Kept the README focused on product scenes, user decisions, trust, and the first-run path.
- The bundled local-engine snapshot remains byte-identical to the attested 1.13.0 engine snapshot.
- Hosted authentication, account state, note analysis, provider routing, local-engine behavior, and saved settings are unchanged.

## Verification

- Official Obsidian ESLint rules plus the added type-aware CommonJS audit checks pass with zero warnings.
- All 103 automated tests pass.
- The deterministic bundle is rebuilt twice, compared byte-for-byte, and checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine smoke tests pass.
- README screenshot links resolve to full-window Obsidian captures.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should remain **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
