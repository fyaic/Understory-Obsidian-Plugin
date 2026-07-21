/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const { Notice, TFile } = require('obsidian');
const { GraphifyContentModal } = require('./utils');
const { t } = require('./i18n');

class GraphifyViewMethods {
    _openGraphifyIndex() {
        // \u6ce8\u610f\uff1a.understory/ \u662f\u70b9\u524d\u7f00\u9690\u85cf\u76ee\u5f55\uff0cObsidian \u7684 vault API \u4e0d\u7d22\u5f15\u5b83\uff0c
        // \u6240\u4ee5\u4e0d\u80fd\u7528 getAbstractFileByPath/openFile \u2014\u2014 \u5fc5\u987b\u7528 fs \u76f4\u63a5\u8bfb\uff0c\u518d\u7528 Modal \u6e32\u67d3\u3002
        const base = this._vaultBasePath();
        if (!base) return;
        const fs = require('fs');
        const p = `${base}/.understory/index.md`;
        if (!fs.existsSync(p)) {
            new Notice(t(this, 'index_missing_notice'), 5000);
            return;
        }
        let md;
        try { md = fs.readFileSync(p, 'utf-8'); }
        catch { new Notice(t(this, 'index_read_failed_notice'), 4000); return; }
        new GraphifyContentModal(this.app, this, t(this, 'index_modal_title'), md).open();
    }

    // \u7c7b\u578b\u663e\u793a\u540d\uff08\u5b64\u513f\u5355\u5217\uff0c\u4e0d\u8fdb\u51b2\u7a81\u62a5\u544a\uff09
    _conflictTypeName(type) {
        return ({
            principle_contradiction: t(this, 'conflict_type_principle_contradiction'),
            expired_claim: t(this, 'conflict_type_expired_claim'),
            dead_link: t(this, 'conflict_type_dead_link'),
            duplicate_principle: t(this, 'conflict_type_duplicate_principle'),
            inconsistent_term: t(this, 'conflict_type_inconsistent_term'),
            possible_conflict: t(this, 'conflict_type_principle_contradiction'),
            stale_claim: t(this, 'conflict_type_expired_claim'),
            duplicate: t(this, 'conflict_type_duplicate_principle'),
            orphan_page: t(this, 'orphans_title', { count: 1 }),
        })[type] || type;
    }

    _resolveNoteFile(notePath) {
        const raw = String(notePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!raw) return { file: null, path: '', missing: true };
        const path = raw.endsWith('.md') ? raw : `${raw}.md`;
        const exact = this.app.vault.getAbstractFileByPath(path);
        if (exact instanceof TFile) return { file: exact, path, missing: false };

        const stem = path.split('/').pop().replace(/\.md$/, '');
        const byTitle = this.app.metadataCache && this.app.metadataCache.getFirstLinkpathDest
            ? this.app.metadataCache.getFirstLinkpathDest(stem, '')
            : null;
        if (byTitle instanceof TFile) {
            return { file: byTitle, path: byTitle.path, missing: false, redirected: byTitle.path !== path };
        }
        return { file: null, path, missing: true };
    }

    // \u53ef\u70b9\u51fb\u7684\u7b14\u8bb0\u94fe\u63a5\uff1a\u53ea\u6253\u5f00\u5df2\u5b58\u5728\u7684\u771f\u5b9e\u6587\u4ef6\uff0c\u4e0d\u901a\u8fc7 openLinkText \u521b\u5efa\u7a7a\u6587\u6863
    _appendNoteLink(parentEl, notePath, modal) {
        const resolved = this._resolveNoteFile(notePath);
        const stem = (resolved.path || String(notePath || '')).split('/').pop().replace(/\.md$/, '') || '-';
        if (resolved.missing) {
            const missing = parentEl.createEl('span', { text: stem, cls: 'understory-conflict-doc-missing' });
            missing.setAttribute('title', t(this, 'file_missing_title', { path: resolved.path || notePath || '' }));
            parentEl.createEl('span', { text: t(this, 'file_missing_badge'), cls: 'understory-conflict-missing-badge' });
            return missing;
        }
        const a = parentEl.createEl('a', { text: stem, cls: 'understory-note-link' });
        a.setAttribute('title', resolved.redirected
            ? t(this, 'found_by_filename_title', { path: resolved.path })
            : resolved.path);
        a.addEventListener('click', (e) => {
            e.preventDefault();
            if (modal) modal.close();
            this.app.workspace.getLeaf().openFile(resolved.file);
        });
        return a;
    }

    // \u51b2\u7a81"\u8bf4\u660e"\u7cbe\u7b80\uff1a\u8fc7\u671f\u53ea\u663e\u793a"\u5df2\u8fc7\u671f\u7ea6 N \u4e2a\u6708"\uff0c\u5176\u4f59\u7528\u539f\u63cf\u8ff0
    _conflictDesc(it) {
        if (it.type === 'expired_claim') {
            const m = (it.description || '').match(/(\d+)\s*\u4e2a\u6708/);
            return m ? t(this, 'expired_desc_months', { months: m[1] }) : t(this, 'expired_desc');
        }
        return (it.description || '').replace(/\n/g, ' ');
    }

    _openConflictsView() {
        const data = this._readConflicts();
        if (!data || !Array.isArray(data.issues)) {
            new Notice(t(this, 'conflicts_missing_notice'), 5000);
            return;
        }
        // \u51b2\u7a81\u62a5\u544a\u4e0d\u542b\u5b64\u513f\uff08\u5b64\u513f\u5355\u72ec\u770b\uff09
        const open = data.issues.filter(i => i.status === 'open' && i.type !== 'orphan_page');
        if (open.length === 0) {
            new Notice(t(this, 'conflicts_empty_notice'), 5000);
            return;
        }
        new GraphifyContentModal(this.app, this, t(this, 'conflicts_modal_title', { count: open.length }),
            (wrap, modal) => this._buildConflictsDOM(wrap, modal, data, open)).open();
    }

    _buildConflictsDOM(wrap, modal, data, open) {
        const sevIcon = { high: '\ud83d\udd34', medium: '\ud83d\udfe1', low: '\ud83d\udfe2' };
        const sevLabel = {
            high: t(this, 'severity_high'),
            medium: t(this, 'severity_medium'),
            low: t(this, 'severity_low'),
        };
        const order = { high: 0, medium: 1, low: 2 };
        const summary = data.summary || {};
        const counts = open.reduce((acc, item) => {
            const severity = item.severity || 'low';
            acc[severity] = (acc[severity] || 0) + 1;
            return acc;
        }, {});
        const scanTime = (data.scan_time || '-').slice(0, 16).replace('T', ' ');


        const root = wrap.createDiv({ cls: 'understory-conflict-report' });

        const summaryEl = root.createDiv({ cls: 'understory-conflict-summary' });
        const addSummary = (label, value) => {
            const item = summaryEl.createDiv({ cls: 'understory-conflict-summary-item' });
            item.createEl('div', { text: label, cls: 'understory-conflict-summary-label' });
            item.createEl('div', { text: String(value), cls: 'understory-conflict-summary-value' });
        };
        addSummary(t(this, 'summary_scan_time'), scanTime);
        addSummary(t(this, 'summary_open_conflicts'), open.length);
        addSummary(`${sevIcon.high} ${sevLabel.high}`, counts.high || 0);
        addSummary(`${sevIcon.medium} ${sevLabel.medium}`, counts.medium || 0);
        addSummary(`${sevIcon.low} ${sevLabel.low}`, counts.low || 0);
        addSummary(t(this, 'summary_auto_fixed_dead_links'), summary.auto_fixed || 0);

        root.createEl('div', {
            text: t(this, 'conflicts_guide'),
            cls: 'understory-conflict-guide'
        });

        const sorted = [...open].sort((a, b) => {
            const sevDiff = (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
            if (sevDiff !== 0) return sevDiff;
            return this._conflictTypeName(a.type).localeCompare(this._conflictTypeName(b.type));
        });

        for (const sev of ['high', 'medium', 'low']) {
            const g = sorted.filter(i => i.severity === sev);
            if (!g.length) continue;
            const group = root.createDiv({ cls: 'understory-conflict-group' });
            const groupTitle = group.createDiv({ cls: 'understory-conflict-group-title' });
            groupTitle.createDiv({
                cls: 'understory-conflict-heading',
                text: `${sevIcon[sev]} ${sevLabel[sev] || sev}`,
                attr: { role: 'heading', 'aria-level': '3' },
            });
            groupTitle.createEl('span', { text: t(this, 'conflict_count_suffix', { count: g.length }), cls: 'understory-conflict-count' });
            const table = group.createDiv({ cls: 'understory-conflict-table' });
            const head = table.createDiv({ cls: 'understory-conflict-row understory-conflict-row--head' });
            for (const label of [
                t(this, 'conflict_table_type'),
                t(this, 'conflict_table_notes'),
                t(this, 'conflict_table_desc'),
                t(this, 'conflict_table_suggestion'),
            ]) {
                head.createEl('div', { text: label, cls: 'understory-conflict-cell' });
            }
            const addCell = (row, label, cls) => {
                const cell = row.createDiv({ cls: `understory-conflict-cell${cls ? ` ${cls}` : ''}` });
                cell.setAttribute('data-label', label);
                return cell;
            };
            for (const it of g.slice(0, 200)) {
                const row = table.createDiv({ cls: `understory-conflict-row understory-conflict-row--${sev}` });
                addCell(row, t(this, 'conflict_table_type'), 'understory-conflict-cell--type')
                    .createEl('span', { text: this._conflictTypeName(it.type) });
                const docsEl = addCell(row, t(this, 'conflict_table_notes'), 'understory-conflict-docs');
                const docs = [it.doc_a, it.doc_b, it.doc].filter(Boolean);
                if (docs.length) {
                    docs.forEach((d, idx) => {
                        if (idx > 0) docsEl.createEl('span', { text: '\u2194', cls: 'understory-conflict-arrow' });
                        this._appendNoteLink(docsEl, d, modal);
                    });
                } else if (it.term) {
                    docsEl.createEl('span', { text: t(this, 'conflict_term_label', { term: it.term }) });
                } else {
                    docsEl.createEl('span', { text: '-' });
                }
                addCell(row, t(this, 'conflict_table_desc'), 'understory-conflict-desc')
                    .createEl('span', { text: this._conflictDesc(it) });
                addCell(row, t(this, 'conflict_table_suggestion'), 'understory-conflict-suggestion')
                    .createEl('span', { text: it.suggestion ? String(it.suggestion).replace(/\n/g, ' ') : '-' });
            }
            if (g.length > 200) {
                group.createEl('div', {
                    text: t(this, 'conflict_more_hidden', { count: g.length - 200 }),
                    cls: 'understory-conflict-guide'
                });
            }
        }
    }

}

module.exports = GraphifyViewMethods.prototype;

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
