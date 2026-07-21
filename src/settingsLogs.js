/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const { Setting, TFile } = require('obsidian');
const { t } = require('./i18n');

class SettingsLogMethods {
    _renderLogs(containerEl) {
        const logContainer = containerEl.createDiv({ cls: 'understory-log-container' });
        const logs = this.plugin.settings.linkLog || [];

        if (logs.length === 0) {
            logContainer.createEl('div', {
                text: t(this.plugin, 'logs_empty'),
                cls: 'setting-item-description understory-log-empty'
            });
        } else {
            for (const entry of logs) {
                const row = logContainer.createDiv({ cls: 'understory-log-row' });
                row.title = t(this.plugin, 'logs_click_title');

                const topRow = row.createDiv({ cls: 'understory-log-row-head' });

                topRow.createEl('span', {
                    text: entry.time || '',
                    cls: 'setting-item-description understory-log-time'
                });

                const badge = topRow.createEl('span', { cls: 'understory-log-badge' });
                if (entry.status === 'ok') {
                    badge.textContent = `+${entry.count || 0}`;
                    badge.addClass('is-success');
                } else if (entry.status === 'error' || entry.status === 'parse_error') {
                    badge.textContent = t(this.plugin, 'log_status_error');
                    badge.addClass('is-error');
                } else if (entry.status === 'skipped') {
                    badge.textContent = t(this.plugin, 'log_status_skipped');
                    badge.addClass('is-skipped');
                } else {
                    badge.textContent = entry.status || t(this.plugin, 'log_status_unknown');
                    badge.addClass('is-neutral');
                }

                row.createEl('div', { text: entry.file || entry.filePath || '', cls: 'understory-log-file' });

                if (entry.relations && entry.relations.length > 0) {
                    row.createEl('div', {
                        text: entry.relations.slice(0, 5).join(', ')
                            + (entry.relations.length > 5 ? ` ${t(this.plugin, 'logs_more_count', { count: entry.relations.length - 5 })}` : ''),
                        cls: 'understory-log-detail',
                    });
                }

                if (entry.message) {
                    const isError = entry.status === 'error' || entry.status === 'parse_error';
                    const msgEl = row.createEl('div', {
                        text: entry.message,
                        cls: `understory-log-detail${isError ? ' is-error' : ''}`,
                    });
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

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- End CommonJS audit bridge. */
