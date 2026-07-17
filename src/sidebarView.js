const { ItemView, Notice, TFile, setIcon } = require('obsidian');
const { t } = require('./i18n');
const { recordBackgroundError } = require('./safety');

const VIEW_TYPE_UNDERSTORY_SIDEBAR = 'understory-sidebar';
const UNDERSTORY_ICON = 'leaf';

class UnderstorySidebarView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.sidebarEl = null;
        this.viewActionsRegistered = false;
        this.activePage = 'suggestions';
        this.renderVersion = 0;
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
        this.registerEvent(this.app.workspace.on('understory:account-updated', () => this.render()));
        await this.render();
    }

    async render() {
        if (!this.sidebarEl) return;
        const root = this.sidebarEl;
        const renderVersion = ++this.renderVersion;
        root.empty();

        const file = this.app.workspace.getActiveFile();
        const account = this.plugin.hostedAccountSummary ? this.plugin.hostedAccountSummary() : { status: 'disconnected' };
        this._renderTopbar(root, account);
        if (account.status === 'connected') this._renderConnectedIdentity(root, account);
        if (account.status !== 'connected') {
            this._renderAccountStrip(root, account);
            return;
        }

        if (!file || file.extension !== 'md') {
            this._renderStatePanel(root, 'no-note');
            return;
        }

        if (!this.plugin.relationsStore) {
            this._renderNotePanel(root, file, { disabled: true });
            this._renderStatePanel(root, 'store');
            return;
        }

        try {
            const data = await this.plugin.relationsStore.getRelations(file);
            if (this.sidebarEl !== root || this.renderVersion !== renderVersion) return;
            const variant = data.status === 'missing' ? 'missing' : (data.stale ? 'stale' : 'fresh');
            this._renderNotePanel(root, file, { variant, hideAction: variant !== 'fresh' });
            if (data.status === 'missing') {
                this._renderStatePanel(root, 'missing', file);
                return;
            } else if (data.stale) {
                this._renderStatePanel(root, 'stale', file);
            }
            const hostedRisks = data.entry?.networkMode === 'hosted' ? (data.risks || []) : null;
            this._renderWorkspaceTabs(root, file, data.relations || [], hostedRisks);
            if (this.activePage === 'risks') {
                this._renderConflicts(root, file, hostedRisks);
            } else {
                this._renderRelations(root, file, data.relations || []);
            }
        } catch (error) {
            if (this.sidebarEl !== root || this.renderVersion !== renderVersion) return;
            recordBackgroundError(this.plugin, 'render-sidebar', error);
            this._renderNotePanel(root, file, { disabled: true });
            this._renderStatePanel(root, 'error');
        }
    }

    _renderTopbar(root, account) {
        const header = root.createDiv({ cls: 'understory-sidebar-topbar' });
        const brand = header.createDiv({ cls: 'understory-sidebar-brand' });
        brand.createDiv({
            cls: 'understory-sidebar-heading',
            text: t(this.plugin, 'sidebar_title'),
            attr: { role: 'heading', 'aria-level': '2' },
        });
        brand.createDiv({ cls: 'understory-sidebar-subtitle', text: t(this.plugin, 'sidebar_workspace_subtitle') });
        const actions = header.createDiv({ cls: 'understory-sidebar-actions' });
        this._iconButton(
            actions,
            'refresh-cw',
            t(this.plugin, 'sidebar_refresh'),
            () => this._refreshActiveFile(),
            { disabled: account.status !== 'connected' }
        );
        this._iconButton(
            actions,
            account.status === 'connected' ? 'user-check' : 'user',
            t(this.plugin, account.status === 'connected' ? 'sidebar_account_connected' : 'sidebar_account'),
            () => this._openSettings('account'),
            { cls: `understory-sidebar-account-button is-${account.status}` }
        );
        this._iconButton(actions, 'settings', t(this.plugin, 'sidebar_settings'), () => this._openSettings());
    }

    _renderAccountStrip(root, summary) {
        const pending = summary.status === 'pending';
        const panel = root.createDiv({ cls: `understory-sidebar-account-strip is-${summary.status}` });
        const icon = panel.createDiv({ cls: 'understory-sidebar-account-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(icon, pending ? 'loader-circle' : 'log-in');
        const copy = panel.createDiv({ cls: 'understory-sidebar-account-copy' });
        copy.createEl('strong', { text: t(this.plugin, pending ? 'sidebar_login_pending_title' : 'sidebar_login_title') });
        copy.createDiv({ text: t(this.plugin, pending ? 'sidebar_login_pending_desc' : 'sidebar_login_desc') });

        const actions = panel.createDiv({ cls: 'understory-sidebar-account-actions' });
        if (pending) {
            this._accountButton(actions, t(this.plugin, 'hosted_open_login_again'), async () => {
                await this.plugin.hostedLogin(true);
                await this.render();
            }, { cta: true, icon: 'external-link' });
            this._accountButton(actions, t(this.plugin, 'hosted_cancel_login_button'), async () => {
                await this.plugin.hostedCancelLogin(true);
                await this.render();
            }, { icon: 'x' });
        } else {
            this._accountButton(actions, t(this.plugin, 'hosted_login_button'), async () => {
                await this.plugin.hostedLogin(true);
                await this.render();
            }, { cta: true, icon: 'log-in' });
        }
    }

    _renderConnectedIdentity(root, summary) {
        const profile = summary.displayUser || {};
        const name = String(profile.name || '').trim();
        const email = String(profile.email || '').trim();
        const hasDistinctName = !!name && name.toLowerCase() !== email.toLowerCase();
        const button = root.createEl('button', {
            cls: 'understory-sidebar-identity',
            attr: { type: 'button', title: t(this.plugin, 'sidebar_account_connected') },
        });
        const avatar = button.createSpan({ cls: 'understory-sidebar-identity-avatar', attr: { 'aria-hidden': 'true' } });
        const initials = () => {
            const source = String(profile.name || profile.email || 'U').trim();
            const words = source.split(/\s+/).filter(Boolean);
            return (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : source.slice(0, 1)).toUpperCase() || 'U';
        };
        if (profile.picture) {
            const image = avatar.createEl('img', { attr: { src: profile.picture, alt: '' } });
            image.addEventListener('error', () => {
                avatar.empty();
                avatar.createSpan({ text: initials() });
            });
        } else {
            avatar.createSpan({ text: initials() });
        }
        const copy = button.createSpan({ cls: 'understory-sidebar-identity-copy' });
        copy.createEl('strong', { text: (hasDistinctName ? name : email) || name || t(this.plugin, 'account_connected_title') });
        copy.createSpan({ text: hasDistinctName && email ? email : t(this.plugin, 'account_connected_desc') });
        const status = button.createSpan({ cls: 'understory-sidebar-identity-status', attr: { 'aria-hidden': 'true' } });
        setIcon(status, 'circle-check');
        button.addEventListener('click', () => this._openSettings('account'));
    }

    _renderNotePanel(root, file, state = {}) {
        const panel = root.createDiv({ cls: 'understory-sidebar-note-panel' });
        const copy = panel.createDiv({ cls: 'understory-sidebar-note-copy' });
        copy.createDiv({ cls: 'understory-sidebar-note-label', text: t(this.plugin, 'sidebar_note_label') });
        copy.createDiv({ cls: 'understory-sidebar-note-title', text: file.basename || file.name || file.path });
        copy.createDiv({ cls: 'understory-sidebar-note-path', text: file.path });

        if (state.hideAction) return;
        const action = panel.createDiv({ cls: 'understory-sidebar-note-action' });
        const label = state.variant === 'missing'
            ? t(this.plugin, 'sidebar_missing_refresh')
            : (state.variant === 'stale' ? t(this.plugin, 'sidebar_stale_refresh') : t(this.plugin, 'sidebar_refresh'));
        const loadingLabel = state.variant === 'missing'
            ? t(this.plugin, 'sidebar_missing_refreshing')
            : (state.variant === 'stale' ? t(this.plugin, 'sidebar_stale_refreshing') : t(this.plugin, 'sidebar_refreshing'));
        const button = action.createEl('button', {
            cls: 'understory-icon-button',
            attr: { 'aria-label': label, title: label },
        });
        setIcon(button, 'refresh-cw');
        button.type = 'button';
        button.disabled = !!state.disabled;
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            button.disabled = true;
            button.setAttribute('aria-label', loadingLabel);
            button.setAttribute('title', loadingLabel);
            try {
                await this._refreshActiveFile(file);
            } finally {
                button.disabled = false;
                button.setAttribute('aria-label', label);
                button.setAttribute('title', label);
            }
        });
    }

    _accountButton(parent, text, handler, options = {}) {
        const button = parent.createEl('button');
        button.type = 'button';
        if (options.cta) button.addClass('mod-cta');
        if (options.disabled) button.disabled = true;
        if (options.icon) {
            const icon = button.createSpan({ cls: 'understory-button-icon', attr: { 'aria-hidden': 'true' } });
            setIcon(icon, options.icon);
        }
        button.createSpan({ text, cls: 'understory-button-label' });
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            button.disabled = true;
            try {
                await handler();
            } catch (error) {
                recordBackgroundError(this.plugin, 'account-action', error);
                new Notice(t(this.plugin, 'hosted_action_failed', { message: String(error.message || error).slice(0, 100) }), 8000);
            } finally {
                if (!options.disabled) button.disabled = false;
            }
        });
        return button;
    }

    _iconButton(parent, iconName, label, handler, options = {}) {
        const button = parent.createEl('button', {
            cls: `understory-icon-button ${options.cls || ''}`.trim(),
            attr: { type: 'button', 'aria-label': label, title: label },
        });
        setIcon(button, iconName);
        button.disabled = !!options.disabled;
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            button.disabled = true;
            try {
                await handler();
            } catch (error) {
                recordBackgroundError(this.plugin, 'sidebar-action', error);
                new Notice(t(this.plugin, 'sidebar_action_failed'));
            } finally {
                if (!options.disabled) button.disabled = false;
            }
        });
        return button;
    }

    _renderWorkspaceTabs(root, file, relations, risks = null) {
        const visibleRelations = relations.filter((relation) => relation.status !== 'rejected').length;
        const riskCount = this._relatedConflicts(file, risks).length;
        const nav = root.createDiv({ cls: 'understory-sidebar-tabs', attr: { role: 'tablist' } });
        for (const [id, label, count] of [
            ['suggestions', t(this.plugin, 'sidebar_suggestions_heading'), visibleRelations],
            ['risks', t(this.plugin, 'sidebar_risks_heading'), riskCount],
        ]) {
            const button = nav.createEl('button', {
                cls: `understory-sidebar-tab ${this.activePage === id ? 'is-active' : ''}`,
                attr: { type: 'button', role: 'tab', 'aria-selected': String(this.activePage === id) },
            });
            button.createSpan({ text: label });
            button.createSpan({ text: String(count), cls: 'understory-sidebar-tab-count' });
            button.addEventListener('click', async () => {
                this.activePage = id;
                await this.render();
            });
        }
    }

    _renderStatePanel(root, variant = 'stale', file = null) {
        const prefix = variant === 'missing' ? 'sidebar_missing' : (variant === 'stale' ? 'sidebar_stale' : '');
        const panel = root.createDiv({ cls: `understory-sidebar-state understory-sidebar-state--${variant}` });
        if (variant === 'no-note') {
            panel.createDiv({ cls: 'understory-sidebar-state-title', text: t(this.plugin, 'sidebar_no_note_title') });
            panel.createDiv({ cls: 'understory-sidebar-state-body', text: t(this.plugin, 'sidebar_open_note') });
            return;
        }
        if (variant === 'store') {
            panel.createDiv({ cls: 'understory-sidebar-state-title', text: t(this.plugin, 'sidebar_store_title') });
            panel.createDiv({ cls: 'understory-sidebar-state-body', text: t(this.plugin, 'sidebar_store_missing') });
            return;
        }
        if (variant === 'error') {
            panel.createDiv({ cls: 'understory-sidebar-state-title', text: t(this.plugin, 'sidebar_error_title') });
            panel.createDiv({ cls: 'understory-sidebar-state-body', text: t(this.plugin, 'sidebar_read_failed') });
            return;
        }
        panel.createDiv({ cls: 'understory-sidebar-state-title', text: t(this.plugin, `${prefix}_title`) });
        panel.createDiv({ cls: 'understory-sidebar-state-body', text: t(this.plugin, `${prefix}_body`) });
        panel.createDiv({ cls: 'understory-sidebar-state-hint', text: t(this.plugin, `${prefix}_hint`) });
        if (!file) return;
        const actions = panel.createDiv({ cls: 'understory-sidebar-state-actions' });
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
        this._renderStatePanel(root, 'stale', file);
    }

    _registerViewActions() {
        if (this.viewActionsRegistered || typeof this.addAction !== 'function') return;
        this.viewActionsRegistered = true;
        this.addAction(UNDERSTORY_ICON, t(this.plugin, 'action_show_understory'), () => this.render());
        this.addAction('refresh-cw', t(this.plugin, 'action_refresh_understory'), () => this._refreshActiveFile());
        this.addAction('settings', t(this.plugin, 'action_settings'), () => this._openSettings());
    }

    _openSettings(page = '') {
        if (page && this.plugin.settingTab) this.plugin.settingTab._activeSettingsPage = page;
        this.app.setting.open();
        this.app.setting.openTabById(this.plugin.manifest.id);
    }

    async _refreshActiveFile(file = this.app.workspace.getActiveFile()) {
        if (this.plugin._shouldUseHostedDiscovery?.() && !this.plugin._hostedAccessToken?.()) {
            this._openSettings('account');
            return;
        }
        if (!file || file.extension !== 'md') {
            new Notice(t(this.plugin, 'sidebar_need_markdown'));
            return;
        }
        if (this.plugin._isPathExcluded?.(file.path)) {
            new Notice(t(this.plugin, 'notice_note_excluded'));
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
            recordBackgroundError(this.plugin, 'refresh-sidebar', error);
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
        const section = root.createDiv({ cls: 'understory-sidebar-section understory-sidebar-suggestions' });
        this._renderSectionHeader(section, t(this.plugin, 'sidebar_suggestions_heading'), groups.size ? String(relations.filter((relation) => relation.status !== 'rejected').length) : '');
        if (groups.size === 0) {
            section.createDiv({ cls: 'understory-sidebar-empty', text: t(this.plugin, 'sidebar_no_relations') });
            return;
        }

        for (const [group, items] of groups.entries()) {
            const groupEl = section.createDiv({ cls: 'understory-sidebar-group' });
            groupEl.createDiv({ cls: 'understory-sidebar-group-title', text: `${group} (${items.length})` });
            for (const relation of items) {
                this._renderRelationItem(groupEl, file, relation);
            }
        }
    }

    _renderSectionHeader(parent, title, count = '') {
        const header = parent.createDiv({ cls: 'understory-sidebar-section-title' });
        header.createSpan({ text: title });
        if (count) header.createSpan({ text: count, cls: 'understory-sidebar-section-count' });
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
        if (this.plugin.settings.sidebarShowScores !== false && Number.isFinite(Number(relation.score))) {
            const score = Math.round(Math.max(0, Math.min(1, Number(relation.score))) * 100);
            main.createDiv({
                cls: 'understory-sidebar-item-meta',
                text: t(this.plugin, 'sidebar_match_score', { score }),
            });
        }

        const actions = item.createDiv({ cls: 'understory-sidebar-item-actions' });
        this._iconButton(actions, 'check', t(this.plugin, 'sidebar_accept'), async () => {
            await this.plugin.relationsStore.accept(file.path, relation.title);
            await this.render();
        });
        this._iconButton(actions, 'x', t(this.plugin, 'sidebar_reject'), async () => {
            await this.plugin.relationsStore.reject(file.path, relation.title);
            await this.render();
        });
        this._iconButton(actions, 'link-2', t(this.plugin, 'sidebar_insert'), async () => {
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

    _renderConflicts(root, file, hostedRisks = null) {
        const section = root.createDiv({ cls: 'understory-sidebar-section understory-sidebar-conflicts' });
        this._renderSectionHeader(section, t(this.plugin, 'sidebar_risks_heading'));
        if (this.plugin.settings.sidebarShowConflicts === false) {
            section.createDiv({ cls: 'understory-sidebar-empty', text: t(this.plugin, 'sidebar_risks_disabled') });
            return;
        }
        const related = this._relatedConflicts(file, hostedRisks);
        if (!related.length) {
            section.createDiv({ cls: 'understory-sidebar-empty', text: t(this.plugin, 'sidebar_risks_empty') });
            return;
        }

        section.empty();
        this._renderSectionHeader(section, t(this.plugin, 'sidebar_conflicts', { count: related.length }));
        for (const issue of related.slice(0, 8)) {
            const severity = ['high', 'medium', 'low'].includes(issue.severity) ? issue.severity : 'low';
            const typeName = this.plugin._conflictTypeName ? this.plugin._conflictTypeName(issue.type) : issue.type;
            const description = String(issue.description || issue.suggestion || '').trim();
            const preview = description.length > 160
                ? `${description.slice(0, 159).trimEnd()}\u2026`
                : description;
            const row = section.createDiv({ cls: `understory-sidebar-conflict understory-sidebar-conflict--${severity}` });
            row.createDiv({
                cls: 'understory-sidebar-conflict-main',
                text: `${typeName} \u00b7 ${t(this.plugin, `severity_${severity}`)}`,
            });
            const descriptionEl = row.createDiv({ cls: 'understory-sidebar-conflict-desc', text: preview });
            if (description) descriptionEl.setAttribute('title', description);
        }
        if (!Array.isArray(hostedRisks)) {
            const open = section.createEl('button', { text: t(this.plugin, 'sidebar_open_conflicts') });
            open.addEventListener('click', () => this.plugin._openConflictsView && this.plugin._openConflictsView());
        }
    }

    _relatedConflicts(file, hostedRisks = null) {
        if (!file) return [];
        if (Array.isArray(hostedRisks)) {
            return hostedRisks.filter((issue) => issue.status === 'open'
                && [issue.doc_a, issue.doc_b, issue.candidate_path].filter(Boolean).includes(file.path));
        }
        const data = this.plugin._readConflicts ? this.plugin._readConflicts() : null;
        const issues = data && Array.isArray(data.issues) ? data.issues : [];
        return issues.filter((issue) => issue.status === 'open'
            && [issue.doc_a, issue.doc_b, issue.doc].filter(Boolean).includes(file.path));
    }
}

module.exports = { UnderstorySidebarView, VIEW_TYPE_UNDERSTORY_SIDEBAR, UNDERSTORY_ICON };
