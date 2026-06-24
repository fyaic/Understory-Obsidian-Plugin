const { Plugin, Notice } = require('obsidian');
const {
    ENGINE_DIR_ENV,
    LEGACY_ENGINE_DIR_ENV,
    UnderstorySettingTab,
    isLikelyEngineDir,
} = require('./settings');
const { registerCoreCommands } = require('./commands');
const graphifyLayer = require('./graphifyLayer');
const linkDiscoveryMethods = require('./linkDiscovery');
const { RelationsStore } = require('./relationsStore');
const { createAgentApi } = require('./agentApi');
const { ensureBundledEngine } = require('./bundledEngine');
const { UnderstorySidebarView, VIEW_TYPE_UNDERSTORY_SIDEBAR, UNDERSTORY_ICON } = require('./sidebarView');
const { t } = require('./i18n');

class UnderstoryPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        await this._ensureBundledEngineInstalled();

        this.timers = new Map();
        this.relationsStore = new RelationsStore(this);
        this.agentApi = createAgentApi({
            app: this.app,
            settings: this.settings,
            relationsStore: this.relationsStore,
            plugin: this,
        });

        this.addSettingTab(new UnderstorySettingTab(this.app, this));
        this.registerView(
            VIEW_TYPE_UNDERSTORY_SIDEBAR,
            (leaf) => new UnderstorySidebarView(leaf, this)
        );
        this.addRibbonIcon(UNDERSTORY_ICON, t(this, 'action_show_understory'), () => this.openSidebar());
        registerCoreCommands(this);

        this.isRunning = false;
        this.runQueue = Promise.resolve();
        this.queuedPaths = new Set();
        this.queuedTasks = new Map();
        this.refreshTimer = null;
        this.daemonProcess = null;

        this.ingestTimers = new Map();
        this.periodicTimer = null;
        this._initGraphifyAI();

        this._runWhenWorkspaceReady(() => {
            this.registerEvent(this.app.vault.on('create', (file) => {
                if (file.extension === 'md') this.scheduleLink(file);
            }));
            this.registerEvent(this.app.vault.on('delete', (file) => {
                this._clearScheduledLink(file?.path);
            }));
            this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
                this._clearScheduledLink(oldPath);
                if (file?.extension === 'md') {
                    this._clearScheduledLink(file.path);
                }
            }));

            if (this.settings.autoRefreshEnabled) {
                this.checkAndStartRefresh();
            }

            if (this.settings.daemonEnabled) {
                this.startDaemon().catch((error) => console.warn('[Understory] Failed to start daemon:', error));
            }

        });

        new Notice(t(this, 'plugin_enabled'));
    }

    async _ensureBundledEngineInstalled() {
        try {
            const bundledEngine = await ensureBundledEngine(this, this.bundledEngineOptions || {});
            this.bundledEngine = bundledEngine;
            if (!bundledEngine?.ok || !bundledEngine.engineDir) return;

            const currentEngineDir = String(this.settings?.graphifyDir || '').trim();
            const savedEngineDir = String(this._loadedSettingsData?.graphifyDir || '').trim();
            const env = typeof process !== 'undefined' ? process.env || {} : {};
            const envEngineDir = String(env[ENGINE_DIR_ENV] || env[LEGACY_ENGINE_DIR_ENV] || '').trim();
            if (!envEngineDir && (!savedEngineDir || !currentEngineDir || !isLikelyEngineDir(currentEngineDir))) {
                this.settings.graphifyDir = bundledEngine.engineDir;
                await this.saveSettings();
            }
        } catch (error) {
            console.warn('[Understory] Failed to install bundled engine:', error);
        }

        if (this.checkEngineHealth) {
            this.checkEngineHealth(false).catch((error) => {
                console.warn('[Understory] Engine health check failed:', error);
            });
        }
    }

    _runWhenWorkspaceReady(callback) {
        if (this.app.workspace.onLayoutReady) {
            this.app.workspace.onLayoutReady(callback);
        } else {
            window.setTimeout(callback, 1000);
        }
    }

    _isRightSidebarLeaf(leaf) {
        const workspace = this.app?.workspace;
        const root = leaf?.getRoot?.();
        if (!root) return false;
        if (workspace?.rightSplit && root === workspace.rightSplit) return true;

        const sideText = String(root.side || root.type || root.id || root.constructor?.name || '').toLowerCase();
        if (sideText.includes('right')) return true;

        const container = root.containerEl || root.container || root.el;
        const classList = container?.classList;
        if (classList?.contains?.('mod-right-split')) return true;
        const className = String(container?.className || '').toLowerCase();
        return className.includes('mod-right-split') || className.includes('right');
    }

    async ensureSidebarLeaf({ reveal = false } = {}) {
        const workspace = this.app.workspace;
        const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_UNDERSTORY_SIDEBAR);
        let leaf = existingLeaves.find((candidate) => this._isRightSidebarLeaf(candidate));
        if (!leaf) {
            leaf = workspace.getRightLeaf(false) || workspace.getRightLeaf(true);
            if (!leaf) {
                if (reveal) new Notice(t(this, 'open_sidebar_failed'));
                return null;
            }
            await leaf.setViewState({ type: VIEW_TYPE_UNDERSTORY_SIDEBAR, active: true });
        }
        await Promise.all(existingLeaves
            .filter((candidate) => candidate !== leaf && candidate.detach)
            .map((candidate) => candidate.detach()));
        if (reveal) workspace.revealLeaf(leaf);
        return leaf;
    }

    async openSidebar() {
        await this.ensureSidebarLeaf({ reveal: true });
    }

}

function mixinPrototype(target, source) {
    for (const name of Object.getOwnPropertyNames(source)) {
        if (name === 'constructor') continue;
        Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name));
    }
}

mixinPrototype(UnderstoryPlugin.prototype, graphifyLayer.core);
mixinPrototype(UnderstoryPlugin.prototype, graphifyLayer.views);
mixinPrototype(UnderstoryPlugin.prototype, graphifyLayer.runtime);
mixinPrototype(UnderstoryPlugin.prototype, linkDiscoveryMethods);

module.exports = UnderstoryPlugin;
