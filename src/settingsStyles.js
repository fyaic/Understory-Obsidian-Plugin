class SettingsStyleMethods {
    _injectStyles(containerEl) {
        const style = containerEl.createEl('style');
        style.textContent = `
.understory-title { margin-bottom: 16px; }
.understory-settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}
.understory-settings-brand {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 9px;
}
.understory-settings-logo {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    object-fit: contain;
}
.understory-settings-title {
    min-width: 0;
    margin: 0;
    font-size: var(--font-ui-large);
    font-weight: 600;
}
.understory-language-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 48px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--background-secondary);
    cursor: pointer;
    font-size: var(--font-ui-smaller);
    line-height: 1;
}
.understory-language-toggle:hover {
    color: var(--text-normal);
    background: var(--background-secondary-alt);
}
.understory-language-toggle-icon {
    font-size: 14px;
}
.understory-language-toggle-label {
    font-weight: 600;
}
.understory-settings-toggle {
    margin: 8px 0 16px;
}
.understory-settings-toggle-label {
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-weight: 600;
}
.understory-settings-tablist {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    gap: 2px;
    overflow-x: auto;
    padding: 3px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    background: var(--background-secondary);
}
.understory-settings-toggle-button {
    flex: 0 0 auto;
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 6px 12px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--font-ui-small);
    line-height: 1.2;
    white-space: nowrap;
}
.understory-settings-toggle-button:hover,
.understory-settings-toggle-button:focus-visible {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
}
.understory-settings-toggle-button.is-active {
    border-color: var(--interactive-accent);
    color: var(--text-on-accent);
    background: var(--interactive-accent);
    font-weight: 600;
}
.understory-settings-page {
    padding-bottom: 12px;
}
.understory-tab-intro {
    margin: 0 0 14px;
}
.understory-tab-intro-title {
    font-size: var(--font-ui-large);
    font-weight: 650;
    margin-bottom: 4px;
    color: var(--text-normal);
}
.understory-tab-intro-desc {
    color: var(--text-muted);
    line-height: 1.45;
    max-width: 720px;
}
.understory-section-title-text {
    margin: 18px 0 4px;
    font-size: var(--font-ui-medium);
    font-weight: 650;
    color: var(--text-normal);
}
.understory-section-subtitle-text {
    margin: 12px 0 4px;
    font-weight: 600;
    color: var(--text-normal);
}
.understory-privacy-intro {
    margin-bottom: 10px;
    line-height: 1.45;
}
.understory-privacy-note {
    margin: 6px 0 10px;
    color: var(--text-muted);
    line-height: 1.45;
}
.understory-privacy-inline-note {
    margin: 6px 0 12px;
    color: var(--text-muted);
    line-height: 1.45;
}
.understory-privacy-footnote {
    margin: 4px 0 12px;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    line-height: 1.4;
}
.understory-setup-card {
    border: 1px solid var(--background-modifier-border);
    border-left: 3px solid var(--interactive-accent);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    background: var(--background-secondary);
}
.understory-setup-card.is-ready {
    border-left-color: var(--text-success);
}
.understory-setup-card.is-warning,
.understory-setup-card.is-needed,
.understory-setup-card.is-unchecked {
    border-left-color: var(--text-warning);
}
.understory-setup-card.is-error {
    border-left-color: var(--text-error);
}
.understory-setup-card-title {
    font-size: var(--font-ui-medium);
    font-weight: 650;
    margin-bottom: 4px;
}
.understory-setup-card-desc {
    color: var(--text-muted);
    line-height: 1.45;
}
.understory-embedding-panel {
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 14px 16px;
    margin: 12px 0 16px;
    background: var(--background-primary);
}
.understory-embedding-panel.is-ready {
    border-color: var(--text-success);
}
.understory-embedding-panel.is-warning,
.understory-embedding-panel.is-unchecked {
    border-color: var(--text-warning);
}
.understory-embedding-panel.is-error {
    border-color: var(--text-error);
}
.understory-embedding-panel.is-info {
    border-color: var(--background-modifier-border);
}
.understory-embedding-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.understory-embedding-title {
    font-weight: 650;
    min-width: 0;
}
.understory-embedding-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 20px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--font-ui-smaller);
    line-height: 1.2;
    white-space: nowrap;
    color: var(--text-muted);
    background: var(--background-secondary);
}
.understory-embedding-chip.is-ready {
    color: var(--text-success);
}
.understory-embedding-chip.is-warning {
    color: var(--text-warning);
}
.understory-embedding-chip.is-error {
    color: var(--text-error);
}
.understory-embedding-desc {
    margin-top: 6px;
    color: var(--text-muted);
    line-height: 1.45;
    max-width: 76ch;
}
.understory-embedding-meta {
    margin-top: 8px;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    overflow-wrap: anywhere;
}
.understory-embedding-action-row {
    margin-top: 12px;
}
.understory-embedding-primary {
    white-space: normal;
}
.understory-embedding-progress {
    position: relative;
    height: 4px;
    margin-top: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--background-modifier-border);
}
.understory-embedding-progress-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 38%;
    border-radius: inherit;
    background: var(--interactive-accent);
    animation: understory-embedding-progress 1.1s ease-in-out infinite;
}
@keyframes understory-embedding-progress {
    0% { left: -40%; }
    50% { left: 35%; }
    100% { left: 102%; }
}
.understory-setup-steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
    margin: 0 0 12px;
}
.understory-setup-step {
    display: flex;
    gap: 8px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-primary);
}
.understory-setup-step-number {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--background-secondary);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-weight: 700;
}
.understory-setup-step-body {
    min-width: 0;
}
.understory-setup-step-title {
    font-weight: 650;
    color: var(--text-normal);
    margin-bottom: 2px;
}
.understory-setup-step-desc {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.4;
}
.understory-dashboard {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
}
.understory-card {
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--background-secondary);
    transition: background 0.15s;
}
.understory-card:hover { background: var(--background-secondary-alt); }
.understory-card-header {
    font-size: 0.8em;
    color: var(--text-muted);
    margin-bottom: 4px;
}
.understory-card-value {
    font-size: 1.05em;
    font-weight: 600;
}
.understory-card-status--ok { color: var(--text-success); }
.understory-card-status--warn { color: var(--text-warning); }
.understory-card-status--off { color: var(--text-muted); }
.understory-action-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 20px;
}
.understory-action-row button {
    font-size: 0.85em;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
}
.understory-section { margin-bottom: 8px; }
.understory-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    padding: 8px 0;
    border-bottom: 1px solid var(--background-modifier-border);
    font-size: 1.05em;
    font-weight: 600;
    color: var(--text-normal);
    user-select: none;
}
.understory-section-header:hover { color: var(--text-accent); }
.understory-section-toggle {
    font-size: 0.8em;
    color: var(--text-muted);
    transition: transform 0.15s;
}
.understory-section-toggle--open { transform: rotate(90deg); }
.understory-section-body { padding: 8px 0 4px; }
.understory-section-body--collapsed { display: none; }
.understory-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--background-modifier-border);
    margin-bottom: 8px;
}
.understory-tab {
    padding: 4px 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 0.9em;
    color: var(--text-muted);
    user-select: none;
}
.understory-tab:hover { color: var(--text-normal); }
.understory-tab--active {
    border-bottom-color: var(--interactive-accent);
    color: var(--text-accent);
}
.understory-tree-container {
    max-height: 280px;
    overflow: auto;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 4px;
}
.understory-folder-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding-bottom: 8px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--background-modifier-border-hover);
}
.understory-folder-action-button {
    font-size: 0.8em;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
}
.understory-folder-node { margin: 1px 0; }
.understory-folder-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
}
.understory-folder-row--disabled {
    opacity: 0.45;
}
.understory-folder-disclosure {
    width: 20px;
    min-width: 20px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
}
.understory-folder-disclosure--empty {
    visibility: hidden;
    cursor: default;
}
.understory-folder-checkbox {
    width: 14px;
    height: 14px;
    margin: 0;
}
.understory-folder-label {
    cursor: pointer;
    font-size: 0.9em;
    line-height: 1.4;
}
.understory-folder-row--disabled .understory-folder-label {
    cursor: not-allowed;
}
.understory-folder-status {
    margin-left: auto;
    font-size: 0.75em;
    color: var(--text-muted);
    white-space: nowrap;
}
.understory-folder-children {
    margin-left: 24px;
}
.understory-log-container {
    max-height: 320px;
    overflow: auto;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 8px;
}
.understory-log-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 4px;
    border-bottom: 1px solid var(--background-modifier-border-hover);
    cursor: pointer;
}
.understory-log-row:hover { background: var(--background-modifier-hover); }
.understory-log-badge {
    font-size: 0.75em;
    padding: 1px 6px;
    border-radius: 4px;
}
.understory-subsection {
    margin: 8px 0 4px;
    padding-left: 12px;
    border-left: 2px solid var(--background-modifier-border);
}
.understory-scope-tabs {
    display: flex;
    gap: 8px;
    margin: 8px 0;
}
.understory-folder-setting {
    padding-top: 4px;
    padding-bottom: 4px;
}
.understory-engine-panel {
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    background: var(--background-secondary);
}
.understory-engine-summary {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
}
.understory-engine-badge,
.understory-engine-check-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 20px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--font-ui-smaller);
    line-height: 1.2;
    white-space: nowrap;
    border: 1px solid var(--background-modifier-border);
}
.understory-engine-badge.is-ready,
.understory-engine-check-pill.is-ok {
    color: var(--text-success);
    background: var(--background-primary);
}
.understory-engine-badge.is-info {
    color: var(--text-muted);
    background: var(--background-primary);
}
.understory-engine-badge.is-warning,
.understory-engine-check-pill.is-warning {
    color: var(--text-warning);
    background: var(--background-primary);
}
.understory-engine-badge.is-error,
.understory-engine-check-pill.is-error {
    color: var(--text-error);
    background: var(--background-primary);
}
.understory-engine-badge.is-unchecked,
.understory-engine-check-pill.is-skipped,
.understory-engine-check-pill.is-unknown {
    color: var(--text-muted);
    background: var(--background-primary);
}
.understory-engine-summary-text {
    color: var(--text-normal);
    line-height: 1.4;
}
.understory-engine-section {
    margin-top: 12px;
}
.understory-engine-section-title {
    font-weight: 600;
    margin-bottom: 6px;
}
.understory-engine-kv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 6px;
}
.understory-engine-kv {
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-primary);
}
.understory-engine-kv-label {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    margin-bottom: 2px;
}
.understory-engine-kv-value {
    color: var(--text-normal);
    overflow-wrap: anywhere;
}
.understory-engine-checks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
}
.understory-engine-check-group {
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-primary);
}
.understory-engine-check-group-head,
.understory-engine-check-row,
.understory-engine-command-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}
.understory-engine-check-group-head {
    justify-content: space-between;
    font-weight: 600;
    margin-bottom: 6px;
}
.understory-engine-check-row {
    padding: 5px 0;
    border-top: 1px solid var(--background-modifier-border-hover);
}
.understory-engine-check-body {
    min-width: 0;
}
.understory-engine-check-label,
.understory-engine-fix-title {
    font-weight: 600;
}
.understory-engine-check-detail,
.understory-engine-check-empty,
.understory-engine-fix-detail {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.4;
    overflow-wrap: anywhere;
}
.understory-engine-path,
.understory-engine-command {
    display: inline-block;
    max-width: 100%;
    margin-top: 3px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.understory-engine-fixes {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.understory-engine-fix {
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-primary);
}
.understory-engine-fix.is-error {
    border-color: var(--text-error);
}
.understory-engine-fix.is-warning {
    border-color: var(--text-warning);
}
.understory-engine-command-row {
    margin-top: 6px;
    justify-content: space-between;
}
.understory-engine-command-row button {
    flex: 0 0 auto;
}
.understory-agent-step {
    margin: 16px 0 18px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
}
.understory-agent-step-label {
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-weight: 700;
    text-transform: uppercase;
}
.understory-agent-quote-block {
    margin: 8px 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    border-left: 3px solid var(--interactive-accent);
    border-radius: 8px;
    background: var(--background-secondary);
    line-height: 1.45;
}
.understory-agent-identity-list {
    display: grid;
    gap: 7px;
}
.understory-agent-identity-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    min-width: 0;
}
.understory-agent-identity-label {
    flex: 0 0 118px;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-weight: 700;
}
.understory-agent-identity-row.is-warning .understory-agent-identity-label {
    color: var(--text-warning);
}
.understory-agent-identity-value {
    flex: 1 1 180px;
    min-width: 0;
    color: var(--text-normal);
    overflow-wrap: anywhere;
}
.understory-agent-check-list {
    display: grid;
    gap: 6px;
    margin: 8px 0 12px;
}
.understory-agent-check-row {
    display: grid;
    grid-template-columns: minmax(88px, auto) 1fr;
    gap: 8px;
    align-items: center;
    min-width: 0;
    padding: 6px 8px;
    border-left: 3px solid var(--text-warning);
    background: var(--background-secondary);
}
.understory-agent-check-row.is-ok {
    border-left-color: var(--text-success);
}
.understory-agent-check-state {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-weight: 700;
}
.understory-agent-check-label {
    color: var(--text-normal);
    overflow-wrap: anywhere;
}
.understory-agent-preview {
    max-height: 260px;
    overflow: auto;
    margin: 8px 0 10px;
    padding: 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.understory-agent-preview code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.understory-agent-install-notes {
    color: var(--text-muted);
}
.understory-agent-install-note-line {
    margin-top: 4px;
    overflow-wrap: anywhere;
}
.understory-agent-install-note-line:first-child {
    margin-top: 0;
}
.understory-agent-safety-list {
    display: grid;
    gap: 6px;
    margin: 8px 0 12px;
}
.understory-agent-safety-item {
    color: var(--text-muted);
    line-height: 1.45;
}
`;
    }
}

module.exports = SettingsStyleMethods.prototype;
