const Module = require('module');
const path = require('path');

class Notice {
    constructor(message, timeout) {
        this.message = message;
        this.timeout = timeout;
        this.el = {
            style: {},
            addEventListener() {},
        };
        Notice.instances.push(this);
    }

    hide() {
        this.hidden = true;
    }
}

Notice.instances = [];

class TFile {
    constructor(filePath, content = '') {
        this.path = filePath;
        this.basename = path.basename(filePath, path.extname(filePath));
        this.extension = path.extname(filePath).replace(/^\./, '');
        this.stat = { mtime: Date.now() };
        this.content = content;
    }
}

class Modal {
    constructor(app) {
        this.app = app;
        this.contentEl = createElementMock();
    }

    open() {}
    close() {}
}

class ItemView {}

class Plugin {
    constructor(app, manifest = {}) {
        this.app = app;
        this.manifest = manifest;
        this.commands = [];
        this.events = [];
        this.intervals = [];
        this.views = new Map();
        this.ribbonIcons = [];
        this.settingTabs = [];
    }

    async loadData() {
        return {};
    }

    async saveData(data) {
        this.savedData = data;
    }

    addSettingTab(tab) {
        this.settingTabs.push(tab);
    }

    registerView(type, factory) {
        this.views.set(type, factory);
    }

    addRibbonIcon(icon, title, callback) {
        this.ribbonIcons.push({ icon, title, callback });
    }

    addCommand(command) {
        this.commands.push(command);
    }

    registerEvent(eventRef) {
        this.events.push(eventRef);
        return eventRef;
    }

    registerInterval(intervalRef) {
        this.intervals.push(intervalRef);
        return intervalRef;
    }
}

class PluginSettingTab {
    constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = createElementMock();
    }

    display() {}
}

class Setting {
    constructor(containerEl) {
        this.containerEl = containerEl;
    }

    setName() { return this; }
    setDesc() { return this; }
    setHeading() { return this; }
    addButton(callback) { callback(chainableControl()); return this; }
    addDropdown(callback) { callback(chainableControl()); return this; }
    addText(callback) { callback(chainableControl()); return this; }
    addTextArea(callback) { callback(chainableControl()); return this; }
    addToggle(callback) { callback(chainableControl()); return this; }
    addSlider(callback) { callback(chainableControl()); return this; }
}

function chainableControl() {
    const control = {};
    const methods = [
        'addOption', 'setButtonText', 'setCta', 'setDisabled', 'setDynamicTooltip',
        'setLimits', 'setPlaceholder', 'setTooltip', 'setValue', 'onChange',
        'onClick',
    ];
    for (const method of methods) control[method] = () => control;
    return control;
}

function createElementMock() {
    return {
        children: [],
        style: {},
        classList: { add() {}, remove() {} },
        addClass() {},
        addEventListener() {},
        createDiv(options = {}) {
            const child = createElementMock();
            child.options = options;
            this.children.push(child);
            return child;
        },
        createEl(tag, options = {}) {
            const child = createElementMock();
            child.tag = tag;
            child.options = options;
            this.children.push(child);
            return child;
        },
        empty() {
            this.children = [];
        },
        setText(text) {
            this.text = text;
        },
    };
}

const obsidianMock = {
    ItemView,
    MarkdownRenderer: { renderMarkdown: async () => {} },
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
};

function installMockObsidian() {
    if (installMockObsidian.installed) return obsidianMock;
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'obsidian') return obsidianMock;
        return originalLoad.call(this, request, parent, isMain);
    };
    installMockObsidian.installed = true;
    installMockObsidian.restore = () => {
        Module._load = originalLoad;
        installMockObsidian.installed = false;
    };
    return obsidianMock;
}

module.exports = {
    createElementMock,
    installMockObsidian,
    obsidianMock,
};
