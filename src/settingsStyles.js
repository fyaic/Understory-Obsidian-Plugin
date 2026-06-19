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
.understory-settings-title {
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
`;
    }
}

module.exports = SettingsStyleMethods.prototype;
