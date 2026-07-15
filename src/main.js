const { Plugin: ObsidianPlugin, Notice } = require('obsidian');
const {
    UnderstorySettingTab,
    isLikelyEngineDir,
} = require('./settings');
const { registerCoreCommands } = require('./commands');
const graphifyLayer = require('./graphifyLayer');
const linkDiscoveryMethods = require('./linkDiscovery');
const hostedClientMethods = require('./hostedClient');
const hostedDiscoveryMethods = require('./hostedDiscovery');
const hostedAnalysisMethods = require('./hostedAnalysis');
const { registerUnderstoryAuthProtocol } = require('./authProtocol');
const { RelationsStore } = require('./relationsStore');
const { createAgentApi } = require('./agentApi');
const { ensureBundledEngine } = require('./bundledEngine');
const { UnderstorySidebarView, VIEW_TYPE_UNDERSTORY_SIDEBAR, UNDERSTORY_ICON } = require('./sidebarView');
const { t } = require('./i18n');
const { recordBackgroundError } = require('./safety');

class UnderstoryPlugin extends ObsidianPlugin {
    async onload() {
        await this.loadSettings();
        if ((this.settings.networkMode || 'hosted') !== 'hosted') {
            await this._ensureBundledEngineInstalled();
        }

        this.timers = new Map();
        this.relationsStore = new RelationsStore(this);
        this.agentApi = createAgentApi({
            app: this.app,
            settings: this.settings,
            relationsStore: this.relationsStore,
            plugin: this,
        });

        this.settingTab = new UnderstorySettingTab(this.app, this);
        this.addSettingTab(this.settingTab);
        this.registerView(
            VIEW_TYPE_UNDERSTORY_SIDEBAR,
            (leaf) => new UnderstorySidebarView(leaf, this)
        );
        this.addRibbonIcon(UNDERSTORY_ICON, t(this, 'action_show_understory'), () => this.openSidebar());
        registerCoreCommands(this);
        registerUnderstoryAuthProtocol(this);
        const resumePendingLogin = () => {
            this.hostedResumePendingLogin?.().catch((error) => {
                recordBackgroundError(this, 'resume-account-login', error);
            });
        };
        this.registerDomEvent(window, 'focus', resumePendingLogin);
        const activeDocument = this.app.workspace?.containerEl?.ownerDocument || window.document;
        if (activeDocument) {
            this.registerDomEvent(activeDocument, 'visibilitychange', () => {
                if (activeDocument.visibilityState === 'visible') resumePendingLogin();
            });
        }

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
            const hostedMode = (this.settings.networkMode || 'hosted') === 'hosted';
            this.registerEvent(this.app.vault.on('create', (file) => {
                if (file.extension === 'md') this.scheduleLink(file);
            }));
            if (hostedMode) {
                this.registerEvent(this.app.vault.on('modify', (file) => {
                    if (file?.extension === 'md') this.scheduleLink(file);
                }));
            }
            this.registerEvent(this.app.vault.on('delete', (file) => {
                this._clearScheduledLink(file?.path);
            }));
            this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
                this._clearScheduledLink(oldPath);
                if (file?.extension === 'md') {
                    this._clearScheduledLink(file.path);
                }
            }));

            if (!hostedMode && this.settings.autoRefreshEnabled) {
                this.checkAndStartRefresh();
            }

            if (!hostedMode && this.settings.daemonEnabled) {
                this.startDaemon().catch(() => undefined);
            }

            if (hostedMode) {
                this.initHostedAnalysis?.();
                resumePendingLogin();
                if (this._hostedAccessToken?.()) {
                    this.refreshHostedConfig(false)
                        .then(() => this.refreshHostedAccountSurfaces())
                        .catch(() => undefined);
                }
            }
        });
    }

    async _ensureBundledEngineInstalled() {
        if (this.settings?.networkMode === 'hosted') return;
        try {
            const bundledEngine = await ensureBundledEngine(this, this.bundledEngineOptions || {});
            this.bundledEngine = bundledEngine;
            if (!bundledEngine?.ok || !bundledEngine.engineDir) return;

            const currentEngineDir = String(this.settings?.graphifyDir || '').trim();
            const savedEngineDir = String(this._loadedSettingsData?.graphifyDir || '').trim();
            if (!savedEngineDir || !currentEngineDir || !isLikelyEngineDir(currentEngineDir)) {
                this.settings.graphifyDir = bundledEngine.engineDir;
                await this.saveSettings();
            }
        } catch (error) {
            this.engineInstallError = error;
        }

        if (this.checkEngineHealth) {
            this.checkEngineHealth(false).catch(() => undefined);
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

    refreshHostedAccountSurfaces() {
        if (this.settingTab && typeof this.settingTab.display === 'function') {
            this.settingTab.display();
        }
        if (this.app.workspace && typeof this.app.workspace.trigger === 'function') {
            this.app.workspace.trigger('understory:account-updated');
        }
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
mixinPrototype(UnderstoryPlugin.prototype, hostedClientMethods);
mixinPrototype(UnderstoryPlugin.prototype, hostedDiscoveryMethods);
mixinPrototype(UnderstoryPlugin.prototype, hostedAnalysisMethods);

module.exports = UnderstoryPlugin;
