const { Plugin, Notice } = require('obsidian');
const { UnderstorySettingTab } = require('./settings');
const { registerCoreCommands } = require('./commands');
const graphifyLayer = require('./graphifyLayer');
const linkDiscoveryMethods = require('./linkDiscovery');
const { RelationsStore } = require('./relationsStore');
const { UnderstorySidebarView, VIEW_TYPE_UNDERSTORY_SIDEBAR, UNDERSTORY_ICON } = require('./sidebarView');
const { t } = require('./i18n');

class UnderstoryPlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.timers = new Map();
        this.relationsStore = new RelationsStore(this);

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
            await this.startDaemon();
        }

        this.ingestTimers = new Map();
        this.periodicTimer = null;
        this._initGraphifyAI();

        const attachSidebar = () => this.ensureSidebarLeaf({ reveal: !!this.settings.openSidebarOnLoad })
            .catch((error) => console.warn('[Understory] Failed to attach sidebar view:', error));
        if (this.app.workspace.onLayoutReady) {
            this.app.workspace.onLayoutReady(attachSidebar);
        } else {
            window.setTimeout(attachSidebar, 1000);
        }

        console.log('[Understory] Plugin loaded');
        new Notice(t(this, 'plugin_enabled'));
    }

    async ensureSidebarLeaf({ reveal = false } = {}) {
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_UNDERSTORY_SIDEBAR)[0];
        if (!leaf) {
            leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getRightLeaf(true);
            if (!leaf) {
                if (reveal) new Notice(t(this, 'open_sidebar_failed'));
                return null;
            }
            await leaf.setViewState({ type: VIEW_TYPE_UNDERSTORY_SIDEBAR, active: true });
        }
        if (reveal) this.app.workspace.revealLeaf(leaf);
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
