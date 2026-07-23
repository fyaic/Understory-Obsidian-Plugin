# Understory 1.13.9

Understory 1.13.9 makes note scope visible at the moment it matters. When a
configured refresh scope does not include the current note's folder, the
sidebar now explains that manual analysis still works while full-vault and
scheduled refreshes skip that folder.

## What Changed

- Added a compact scope notice below the current-note header.
- Added a direct **Review scope** action that opens the Scope settings page.
- Reused one normalized path-matching rule for the sidebar and refresh queue.
- Kept existing account, usage, relation, risk, principle, and local-engine
  behavior unchanged.
- The bundled local-engine snapshot remains byte-identical to the attested
  1.13.0 engine snapshot.

## Verification

- Official Obsidian ESLint rules and type-aware CommonJS audit checks pass with
  zero warnings.
- All automated tests pass, including refresh-scope matching and sidebar action
  coverage.
- The deterministic bundle is rebuilt twice, compared byte-for-byte, and
  checked with `node --check`.
- Release metadata, engine provenance, embedded engine hashes, and local-engine
  smoke tests pass.
- The exact candidate package is smoke-tested in an isolated vault before the
  tag is published.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community
listing should remain **Optional payments** because Understory connects to a
managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets
to the Understory service. Model credentials remain server-side. See
`PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
