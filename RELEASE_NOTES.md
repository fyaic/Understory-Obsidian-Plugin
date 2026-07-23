# Understory 1.13.10

Understory 1.13.10 tightens the hosted login-only contract. The plugin now
treats AI routing as a server-only implementation detail: users sign in and
use Understory without receiving or selecting provider/model configuration.

## What Changed

- Removed provider/model metadata from sanitized hosted capability config.
- Stopped persisting hosted model selections or passing model environment
  variables into the managed runtime.
- Simplified hosted account copy so normal users see service readiness rather
  than upstream implementation details.
- Kept advanced local/self-hosted provider settings available behind Advanced.
- The bundled local-engine snapshot remains byte-identical to the attested
  1.13.0 engine snapshot.

## Verification

- Official Obsidian ESLint rules and type-aware CommonJS audit checks pass with
  zero warnings.
- All automated tests pass, including hostile routing-metadata sanitization and
  hosted environment isolation.
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
to the Understory service. Provider credentials and route choices remain
server-side. See
`PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
