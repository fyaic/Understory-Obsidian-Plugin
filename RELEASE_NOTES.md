# Understory 1.13.0

Understory 1.13.0 is the hosted-first public release. A new user can sign in with Bondie, return to the current note, and generate real relation suggestions without configuring a model provider, endpoint, Python environment, or API key.

## Highlights

- One clear first-run action: **Continue with Bondie**.
- Stable browser-to-Obsidian login callback and product session exchange.
- Account identity, fallback avatar, Free membership, service readiness, and Bondie account-management entries.
- Account usage totals plus request and processing-unit activity by feature.
- Hosted relation suggestions, risk analysis, principle extraction, and vault semantic review using server-managed provider access.
- Explicit consent before selected note snippets are sent for hosted analysis.
- New multi-page settings and a quieter Suggestions/Risks sidebar in English and Chinese.
- Friendly match percentages and localized risk severity instead of provider/debug labels.
- Product-only logout by default, with Bondie global logout separated behind confirmation.
- Existing local/self-hosted/BYOK and local Agent/MCP workflows remain under Advanced.

## Upgrade Notes

- Fresh installs default to hosted mode.
- Existing installs with saved local mode remain local and do not require a Bondie session.
- Hosted mode clears client provider-key fields and never receives server-managed upstream keys.
- The command ID for opening the sidebar is now `open-sidebar`; users with a custom hotkey for the legacy command may need to bind it again.
- New manually inserted relation sections use the cleaner **Related notes / Confirmed** headings while existing English and Chinese headings remain recognized.

## Verification

- Official Obsidian ESLint rules pass with zero warnings.
- All 99 automated tests pass.
- The release bundle is rebuilt from every `src/*.js` module and passes `node --check`.
- Release metadata, embedded engine hashes, local-engine smoke, and tag/version consistency are checked in CI.
- Real Obsidian 1.12.7 smoke testing covered enable/disable/reload, browser login callback, account identity, hosted suggestions and risks, usage observability, accept/ignore/insert actions, Chinese/English UI, and light/dark themes.

## Payment And Privacy

The current hosted membership is Free and checkout is disabled. The Community listing should be **Optional payments** because Understory connects to a managed service and retains advanced connections to paid APIs.

Hosted analysis sends only bounded, consented note paths, titles, and snippets to the Understory service. Model credentials remain server-side. See `PRIVACY.md` for the complete data-flow and retention disclosure.

## Release Assets

- `manifest.json`
- `main.js`
- `styles.css`
