const { Setting, TFile } = require('obsidian');
const { t } = require('./i18n');

class SettingsLogMethods {
    _renderLogs(containerEl) {
        const logContainer = containerEl.createDiv({ cls: 'understory-log-container' });
        const logs = this.plugin.settings.linkLog || [];

        if (logs.length === 0) {
            logContainer.createEl('div', {
                text: t(this.plugin, 'logs_empty'),
                cls: 'setting-item-description'
            }).style.color = 'var(--text-muted)';
        } else {
            for (const entry of logs) {
                const row = logContainer.createDiv({ cls: 'understory-log-row' });
                row.title = t(this.plugin, 'logs_click_title');

                const topRow = row.createDiv();
                topRow.style.display = 'flex';
                topRow.style.justifyContent = 'space-between';
                topRow.style.alignItems = 'center';

                topRow.createEl('span', {
                    text: entry.time || '',
                    cls: 'setting-item-description'
                }).style.fontSize = '0.75em';

                const badge = topRow.createEl('span', { cls: 'understory-log-badge' });
                if (entry.status === 'ok') {
                    badge.textContent = `+${entry.count || 0}`;
                    badge.style.background = 'var(--background-modifier-success)';
                    badge.style.color = 'var(--text-on-accent)';
                } else if (entry.status === 'error' || entry.status === 'parse_error') {
                    badge.textContent = t(this.plugin, 'log_status_error');
                    badge.style.background = 'var(--background-modifier-error)';
                    badge.style.color = 'var(--text-on-accent)';
                } else if (entry.status === 'skipped') {
                    badge.textContent = t(this.plugin, 'log_status_skipped');
                    badge.style.background = 'var(--background-modifier-border)';
                    badge.style.color = 'var(--text-muted)';
                } else {
                    badge.textContent = entry.status || t(this.plugin, 'log_status_unknown');
                    badge.style.background = 'var(--background-modifier-border)';
                }

                row.createEl('div', { text: entry.file || entry.filePath || '' }).style.fontWeight = '500';

                if (entry.relations && entry.relations.length > 0) {
                    const relsEl = row.createEl('div', {
                        text: entry.relations.slice(0, 5).join(', ')
                            + (entry.relations.length > 5 ? ` ${t(this.plugin, 'logs_more_count', { count: entry.relations.length - 5 })}` : '')
                    });
                    relsEl.style.fontSize = '0.8em';
                    relsEl.style.color = 'var(--text-muted)';
                    relsEl.style.whiteSpace = 'nowrap';
                    relsEl.style.overflow = 'hidden';
                    relsEl.style.textOverflow = 'ellipsis';
                }

                if (entry.message) {
                    const msgEl = row.createEl('div', { text: entry.message });
                    msgEl.style.fontSize = '0.8em';
                    msgEl.style.color = (entry.status === 'error' || entry.status === 'parse_error')
                        ? 'var(--text-error)'
                        : 'var(--text-muted)';
                    msgEl.style.whiteSpace = 'nowrap';
                    msgEl.style.overflow = 'hidden';
                    msgEl.style.textOverflow = 'ellipsis';
                    if (entry.errorCategory) {
                        msgEl.textContent = `[${entry.errorCategory}] ${entry.message}`;
                    }
                }

                row.addEventListener('click', () => {
                    if (!entry.filePath) return;
                    const file = this.plugin.app.vault.getAbstractFileByPath(entry.filePath);
                    if (file instanceof TFile) {
                        this.plugin.app.workspace.getLeaf().openFile(file);
                    }
                });
            }
        }

        new Setting(containerEl)
            .setName(t(this.plugin, 'clear_logs_name'))
            .setDesc(t(this.plugin, 'clear_logs_desc', { count: logs.length }))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'clear_logs_button'))
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.linkLog = [];
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }
}

module.exports = SettingsLogMethods.prototype;
