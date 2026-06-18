const { ItemView, Notice, TFile } = require('obsidian');
const { t } = require('./i18n');

const VIEW_TYPE_UNDERSTORY_SIDEBAR = 'understory-sidebar';
const UNDERSTORY_ICON = 'leaf';

class UnderstorySidebarView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.sidebarEl = null;
        this.viewActionsRegistered = false;
    }

    getViewType() {
        return VIEW_TYPE_UNDERSTORY_SIDEBAR;
    }

    getDisplayText() {
        return t(this.plugin, 'sidebar_title');
    }

    getIcon() {
        return UNDERSTORY_ICON;
    }

    async onOpen() {
        this._registerViewActions();
        const container = this.contentEl || this.containerEl;
        container.empty();
        this.sidebarEl = container.createDiv({ cls: 'understory-sidebar' });
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.render()));
        this.registerEvent(this.app.workspace.on('understory:relations-updated', () => this.render()));
        this.registerEvent(this.app.workspace.on('understory:language-updated', () => this.render()));
        await this.render();
    }

    async render() {
        if (!this.sidebarEl) return;
        const root = this.sidebarEl;
        root.empty();

        const file = this.app.workspace.getActiveFile();
        this._renderHeader(root, file);

        if (!file || file.extension !== 'md') {
            root.createDiv({ cls: 'understory-sidebar-empty', text: t(this.plugin, 'sidebar_open_note') });
            return;
        }

        root.createDiv({ cls: 'understory-sidebar-current', text: t(this.plugin, 'sidebar_current', { path: file.path }) });

        if (!this.plugin.relationsStore) {
            root.createDiv({ cls: 'understory-sidebar-empty', text: t(this.plugin, 'sidebar_store_missing') });
            return;
        }

        try {
            const data = await this.plugin.relationsStore.getRelations(file);
            if (data.status === 'missing') {
                this._renderRefreshPrompt(root, file, 'missing');
            } else if (data.stale) {
                this._renderRefreshPrompt(root, file, 'stale');
            }
            this._renderRelations(root, file, data.relations || []);
            this._renderConflicts(root, file);
        } catch (error) {
            console.error('[Understory] Sidebar render failed:', error);
            root.createDiv({ cls: 'understory-sidebar-empty', text: t(this.plugin, 'sidebar_read_failed') });
        }
    }

    _renderHeader(root, file) {
        const header = root.createDiv({ cls: 'understory-sidebar-header' });
        header.createEl('h3', { text: t(this.plugin, 'sidebar_title') });
        const actions = header.createDiv({ cls: 'understory-sidebar-actions' });
        const refresh = actions.createEl('button', { text: t(this.plugin, 'sidebar_refresh') });
        refresh.addEventListener('click', async () => {
            refresh.disabled = true;
            refresh.textContent = t(this.plugin, 'sidebar_refreshing');
            try {
                await this._refreshActiveFile(file);
            } finally {
                refresh.disabled = false;
                refresh.textContent = t(this.plugin, 'sidebar_refresh');
            }
        });
        const settings = actions.createEl('button', { text: t(this.plugin, 'sidebar_settings') });
        settings.addEventListener('click', () => this._openSettings());
    }

    _renderRefreshPrompt(root, file, variant = 'stale') {
        const prefix = variant === 'missing' ? 'sidebar_missing' : 'sidebar_stale';
        const panel = root.createDiv({ cls: `understory-sidebar-refresh-prompt understory-sidebar-refresh-prompt--${variant}` });
        panel.createDiv({ cls: 'understory-sidebar-refresh-title', text: t(this.plugin, `${prefix}_title`) });
        panel.createDiv({ cls: 'understory-sidebar-refresh-body', text: t(this.plugin, `${prefix}_body`) });
        panel.createDiv({ cls: 'understory-sidebar-refresh-hint', text: t(this.plugin, `${prefix}_hint`) });
        const actions = panel.createDiv({ cls: 'understory-sidebar-refresh-actions' });
        const refresh = actions.createEl('button', { text: t(this.plugin, `${prefix}_refresh`) });
        refresh.type = 'button';
        refresh.addEventListener('click', async (event) => {
            event.preventDefault();
            refresh.disabled = true;
            refresh.textContent = t(this.plugin, `${prefix}_refreshing`);
            try {
                await this._refreshActiveFile(file);
            } finally {
                refresh.disabled = false;
                refresh.textContent = t(this.plugin, `${prefix}_refresh`);
            }
        });
    }

    _renderStaleState(root, file) {
        this._renderRefreshPrompt(root, file, 'stale');
    }

    _registerViewActions() {
        if (this.viewActionsRegistered || typeof this.addAction !== 'function') return;
        this.viewActionsRegistered = true;
        this.addAction(UNDERSTORY_ICON, t(this.plugin, 'action_show_understory'), () => this.render());
        this.addAction('refresh-cw', t(this.plugin, 'action_refresh_understory'), () => this._refreshActiveFile());
        this.addAction('settings', t(this.plugin, 'action_settings'), () => this._openSettings());
    }

    _openSettings() {
        this.app.setting.open();
        this.app.setting.openTabById(this.plugin.manifest.id);
    }

    async _refreshActiveFile(file = this.app.workspace.getActiveFile()) {
        if (!file || file.extension !== 'md') {
            new Notice(t(this.plugin, 'sidebar_need_markdown'));
            return;
        }
        if (!this.plugin.relationsStore) {
            new Notice(t(this.plugin, 'sidebar_store_notice'));
            return;
        }
        try {
            await this.plugin.relationsStore.discoverAndCache(file, true);
            new Notice(t(this.plugin, 'sidebar_refreshed'));
        } catch (error) {
            console.error('[Understory] Sidebar refresh failed:', error);
            new Notice(t(this.plugin, 'sidebar_refresh_failed', { message: String(error.message || error).slice(0, 80) }));
        } finally {
            await this.render();
        }
    }

    _groupRelations(relations) {
        const visible = relations.filter((relation) => relation.status !== 'rejected');
        const groups = new Map();
        for (const relation of visible) {
            const key = this.plugin.settings.sidebarGroupBy === 'type'
                ? (relation.type || 'semantic')
                : (relation.group || t(this.plugin, 'sidebar_default_group'));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(relation);
        }
        return groups;
    }

    _renderRelations(root, file, relations) {
        const groups = this._groupRelations(relations);
        if (groups.size === 0) {
            root.createDiv({ cls: 'understory-sidebar-empty', text: t(this.plugin, 'sidebar_no_relations') });
            return;
        }

        for (const [group, items] of groups.entries()) {
            const section = root.createDiv({ cls: 'understory-sidebar-section' });
            section.createDiv({ cls: 'understory-sidebar-section-title', text: `${group} (${items.length})` });
            for (const relation of items) {
                this._renderRelationItem(section, file, relation);
            }
        }
    }

    _renderRelationItem(parent, file, relation) {
        const item = parent.createDiv({ cls: `understory-sidebar-item understory-sidebar-item--${relation.status || 'suggested'}` });
        const main = item.createDiv({ cls: 'understory-sidebar-item-main' });
        const link = main.createEl('a', { text: relation.title || relation.target });
        link.setAttribute('title', relation.target || relation.title);
        link.addEventListener('click', (event) => {
            event.preventDefault();
            this._openRelationTarget(relation);
        });
        const meta = main.createDiv({ cls: 'understory-sidebar-item-meta' });
        meta.createSpan({ text: relation.source || relation.type || 'semantic' });
        if (this.plugin.settings.sidebarShowScores !== false && Number.isFinite(Number(relation.score))) {
            meta.createSpan({ text: Number(relation.score).toFixed(2), cls: 'understory-sidebar-score' });
        }

        const actions = item.createDiv({ cls: 'understory-sidebar-item-actions' });
        this._button(actions, t(this.plugin, 'sidebar_accept'), async () => {
            await this.plugin.relationsStore.accept(file.path, relation.title);
            await this.render();
        });
        this._button(actions, t(this.plugin, 'sidebar_reject'), async () => {
            await this.plugin.relationsStore.reject(file.path, relation.title);
            await this.render();
        });
        this._button(actions, t(this.plugin, 'sidebar_insert'), async () => {
            const inserted = await this.plugin.relationsStore.insertRelationIntoBody(file, relation);
            if (inserted) new Notice(t(this.plugin, 'sidebar_inserted'));
            await this.render();
        });
    }

    _button(parent, text, handler) {
        const button = parent.createEl('button', { text });
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            button.disabled = true;
            try {
                await handler();
            } finally {
                button.disabled = false;
            }
        });
        return button;
    }

    _openRelationTarget(relation) {
        const raw = String(relation.target || relation.title || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const candidates = [raw, raw.endsWith('.md') ? raw : `${raw}.md`].filter(Boolean);
        for (const path of candidates) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                this._openFileInNewTab(file);
                return;
            }
        }
        const title = relation.title || raw.replace(/\.md$/, '');
        const byTitle = this.app.metadataCache?.getFirstLinkpathDest
            ? this.app.metadataCache.getFirstLinkpathDest(title, '')
            : null;
        if (byTitle instanceof TFile) {
            this._openFileInNewTab(byTitle);
            return;
        }
        new Notice(t(this.plugin, 'sidebar_target_missing', { title }));
    }

    _openFileInNewTab(file) {
        const workspace = this.app.workspace;
        const leaf = workspace.getLeaf ? workspace.getLeaf('tab') : null;
        if (leaf && leaf.openFile) {
            leaf.openFile(file);
            return;
        }
        if (workspace.openLinkText) {
            workspace.openLinkText(file.path, '', 'tab');
            return;
        }
        workspace.getLeaf().openFile(file);
    }

    _renderConflicts(root, file) {
        if (this.plugin.settings.sidebarShowConflicts === false) return;
        const data = this.plugin._readConflicts ? this.plugin._readConflicts() : null;
        const issues = data && Array.isArray(data.issues) ? data.issues : [];
        const related = issues.filter((issue) => issue.status === 'open'
            && [issue.doc_a, issue.doc_b, issue.doc].filter(Boolean).includes(file.path));
        if (!related.length) return;

        const section = root.createDiv({ cls: 'understory-sidebar-section understory-sidebar-conflicts' });
        section.createDiv({ cls: 'understory-sidebar-section-title', text: t(this.plugin, 'sidebar_conflicts', { count: related.length }) });
        for (const issue of related.slice(0, 8)) {
            const row = section.createDiv({ cls: `understory-sidebar-conflict understory-sidebar-conflict--${issue.severity || 'low'}` });
            row.createDiv({
                cls: 'understory-sidebar-conflict-main',
                text: `${this.plugin._conflictTypeName ? this.plugin._conflictTypeName(issue.type) : issue.type} · ${issue.severity || 'low'}`,
            });
            row.createDiv({ cls: 'understory-sidebar-conflict-desc', text: String(issue.description || issue.suggestion || '').slice(0, 120) });
        }
        const open = section.createEl('button', { text: t(this.plugin, 'sidebar_open_conflicts') });
        open.addEventListener('click', () => this.plugin._openConflictsView && this.plugin._openConflictsView());
    }
}

module.exports = { UnderstorySidebarView, VIEW_TYPE_UNDERSTORY_SIDEBAR, UNDERSTORY_ICON };
