/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
const notices = [];

class TFile {
    constructor(path) {
        this.path = path;
        this.extension = 'md';
        this.basename = path.split('/').pop().replace(/\.md$/, '');
        this.stat = { mtime: 1 };
    }
}

function makeFakeEl(tag = 'div', opts = {}) {
    const el = {
        tag,
        text: opts.text || '',
        cls: opts.cls || '',
        children: [],
        style: {},
        listeners: {},
        disabled: false,
        type: '',
        textContent: opts.text || '',
        empty() {
            this.children = [];
        },
        createDiv(childOpts = {}) {
            const child = makeFakeEl('div', childOpts);
            this.children.push(child);
            return child;
        },
        createEl(childTag, childOpts = {}) {
            const child = makeFakeEl(childTag, childOpts);
            this.children.push(child);
            return child;
        },
        createSpan(childOpts = {}) {
            const child = makeFakeEl('span', childOpts);
            this.children.push(child);
            return child;
        },
        addEventListener(event, callback) {
            this.listeners[event] = callback;
        },
        setAttribute(name, value) {
            this[name] = value;
        },
        addClass(cls) {
            this.cls = this.cls ? `${this.cls} ${cls}` : cls;
        },
    };
    return el;
}

function flattenFakeEl(el) {
    return [el, ...el.children.flatMap(flattenFakeEl)];
}

Module._load = (request, parent, isMain) => {
    if (request === 'obsidian') {
        return {
            ItemView: class {
                constructor(leaf) {
                    this.leaf = leaf;
                    this.app = leaf.app;
                    this.containerEl = { empty() {}, createDiv() { return {}; } };
                    this.contentEl = { empty() {}, createDiv() { return {}; } };
                    this.actions = [];
                }
                addAction(icon, title, callback) {
                    this.actions.push({ icon, title, callback });
                }
                registerEvent() {}
            },
            PluginSettingTab: class {
                constructor(app, plugin) {
                    this.app = app;
                    this.plugin = plugin;
                }
            },
            Setting: class {
                constructor() { return this; }
                setName() { return this; }
                setDesc() { return this; }
                addText() { return this; }
                addDropdown() { return this; }
                addToggle() { return this; }
                addSlider() { return this; }
                addButton() { return this; }
            },
            Notice: class {
                constructor(message) {
                    this.message = message;
                    this.el = { style: {}, addEventListener() {} };
                    notices.push(message);
                }
                hide() {}
            },
            Modal: class {
                constructor(app) {
                    this.app = app;
                    this.contentEl = { empty() {} };
                }
                open() {}
                close() {}
            },
            MarkdownRenderer: { renderMarkdown() {} },
            setIcon(el, icon) { el.icon = icon; },
            TFile,
        };
    }
    return originalLoad(request, parent, isMain);
};

async function main() {
    const { RelationsStore } = require('../src/relationsStore');
    const { UnderstorySidebarView } = require('../src/sidebarView');
    const { registerCoreCommands } = require('../src/commands');
    const runtimeMethods = require('../src/graphifyRuntime');
    const linkDiscoveryMethods = require('../src/linkDiscovery');
    const hostedClientMethods = require('../src/hostedClient');
    const { DEFAULT_SETTINGS, providerPreset } = require('../src/settings');
    const { t } = require('../src/i18n');

    assert.strictEqual(DEFAULT_SETTINGS.networkMode, 'hosted');
    assert.strictEqual(DEFAULT_SETTINGS.hostedServerUrl, 'https://understory.bondie.io');
    assert.strictEqual(DEFAULT_SETTINGS.webhookEnabled, false);
    assert.strictEqual(DEFAULT_SETTINGS.embeddingProvider, 'hosted');
    assert.strictEqual(DEFAULT_SETTINGS.llmProvider, 'hosted');
    assert.strictEqual(DEFAULT_SETTINGS.presentationMode, 'sidebar');
    assert.strictEqual(DEFAULT_SETTINGS.settingsSchemaVersion, 2);
    assert.strictEqual(providerPreset('openai').baseUrl, 'https://api.openai.com/v1/');
    assert(/does not need any model key/.test(t({ settings: {} }, 'api_key_local_notice')));
    assert(/semantically related notes/.test(t({ settings: {} }, 'embedding_api_key_desc')));
    assert(/Full AI analysis/.test(t({ settings: {} }, 'llm_api_key_desc')));
    assert(/pricing, billing, privacy terms/.test(t({ settings: {} }, 'provider_terms_notice')));
    assert(/hosted service/.test(t({ settings: {} }, 'network_mode_hosted_summary')));
    assert.strictEqual(t({ settings: {} }, 'related_section_heading'), '## Related notes');
    assert.strictEqual(t({ settings: {} }, 'manual_insert_heading'), '### Confirmed');
    assert(/本地模式不需要任何模型密钥/.test(t({ settings: { uiLanguage: 'zh' } }, 'api_key_local_notice')));
    assert(/语义相近的笔记和关系/.test(t({ settings: { uiLanguage: 'zh' } }, 'embedding_api_key_desc')));
    assert(/完整 AI 分析/.test(t({ settings: { uiLanguage: 'zh' } }, 'llm_api_key_desc')));
    assert(/价格、账单、隐私条款/.test(t({ settings: { uiLanguage: 'zh' } }, 'provider_terms_notice')));
    assert(/托管服务/.test(t({ settings: { uiLanguage: 'zh' } }, 'network_mode_hosted_summary')));
    assert.strictEqual(t({ settings: { uiLanguage: 'zh' } }, 'related_section_heading'), '## 关联笔记');
    assert.strictEqual(t({ settings: { uiLanguage: 'zh' } }, 'manual_insert_heading'), '### 已确认');

    const migratedSettings = Object.create(linkDiscoveryMethods);
    let savedSettings = null;
    migratedSettings.loadData = async () => ({ networkMode: 'hosted', presentationMode: 'body' });
    migratedSettings.saveData = async (value) => { savedSettings = value; };
    await migratedSettings.loadSettings();
    assert.strictEqual(migratedSettings.settings.presentationMode, 'sidebar');
    assert.strictEqual(migratedSettings.settings.settingsSchemaVersion, 2);
    assert(savedSettings);

    const persistedHostedSettings = Object.create(linkDiscoveryMethods);
    let sanitizedSavedSettings = null;
    for (const name of Object.getOwnPropertyNames(hostedClientMethods)) {
        if (name === 'constructor') continue;
        Object.defineProperty(
            persistedHostedSettings,
            name,
            Object.getOwnPropertyDescriptor(hostedClientMethods, name)
        );
    }
    persistedHostedSettings.loadData = async () => ({
        networkMode: 'hosted',
        settingsSchemaVersion: 2,
        hostedRuntimeConfig: {
            features: {
                embedding: {
                    enabled: true,
                    model: 'old-server-model',
                    provider: 'old-server-provider',
                    endpoint: { method: 'POST', path: '/v1/embedding' },
                },
            },
        },
    });
    persistedHostedSettings.saveData = async (value) => { sanitizedSavedSettings = value; };
    await persistedHostedSettings.loadSettings();
    assert.strictEqual(persistedHostedSettings.settings.hostedRuntimeConfig.features.embedding.model, undefined);
    assert.strictEqual(persistedHostedSettings.settings.hostedRuntimeConfig.features.embedding.provider, undefined);
    assert(sanitizedSavedSettings);

    const scopedDiscovery = Object.create(linkDiscoveryMethods);
    scopedDiscovery.settings = { refreshFolders: ['Projects/Active'], excludedFolders: [] };
    assert.strictEqual(scopedDiscovery._isPathInRefreshScope('Projects/Active/Plan.md'), true);
    assert.strictEqual(scopedDiscovery._isPathInRefreshScope('Projects/Archive/Plan.md'), false);
    scopedDiscovery.settings.refreshFolders = [];
    assert.strictEqual(scopedDiscovery._isPathInRefreshScope('Anywhere/Plan.md'), true);
    scopedDiscovery.settings.excludedFolders = ['Anywhere/Private'];
    assert.strictEqual(scopedDiscovery._isPathInRefreshScope('Anywhere/Private/Plan.md'), false);

    const envRuntime = Object.create(runtimeMethods);
    envRuntime.settings = {
        graphifyDir: 'C:/UnderstoryEngine',
        networkMode: 'full',
        webhookEnabled: false,
        embeddingProvider: 'openai',
        embeddingBaseUrl: 'https://api.openai.com/v1/',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        embeddingApiKey: 'test-embedding-key',
        llmProvider: 'custom',
        llmBaseUrl: 'https://models.example.test/v1/',
        llmModel: 'test-reasoning-model',
        llmApiKey: 'test-llm-key',
    };
    envRuntime._vaultBasePath = () => 'C:/Vault';
    const pythonEnv = envRuntime._pythonEnv();
    assert.strictEqual(pythonEnv.UNDERSTORY_ENGINE_DIR, 'C:/UnderstoryEngine');
    assert.strictEqual(pythonEnv.OBSIDIAN_VAULT_PATH, 'C:/Vault');
    assert.strictEqual(pythonEnv.UNDERSTORY_NETWORK_MODE, 'full');
    assert.strictEqual(pythonEnv.UNDERSTORY_WEBHOOK_ENABLED, '0');
    assert.strictEqual(pythonEnv.UNDERSTORY_EMBEDDING_PROVIDER, 'openai');
    assert.strictEqual(pythonEnv.UNDERSTORY_EMBEDDING_BASE_URL, 'https://api.openai.com/v1/');
    assert.strictEqual(pythonEnv.UNDERSTORY_EMBEDDING_MODEL, 'text-embedding-3-small');
    assert.strictEqual(pythonEnv.UNDERSTORY_EMBEDDING_DIMENSIONS, '1536');
    assert.strictEqual(pythonEnv.UNDERSTORY_EMBEDDING_API_KEY, 'test-embedding-key');
    assert.strictEqual(pythonEnv.UNDERSTORY_LLM_PROVIDER, 'custom');
    assert.strictEqual(pythonEnv.UNDERSTORY_LLM_BASE_URL, 'https://models.example.test/v1/');
    assert.strictEqual(pythonEnv.UNDERSTORY_LLM_MODEL, 'test-reasoning-model');
    assert.strictEqual(pythonEnv.UNDERSTORY_LLM_API_KEY, 'test-llm-key');

    const hostedRuntime = Object.create(runtimeMethods);
    hostedRuntime.settings = {
        graphifyDir: 'C:/UnderstoryEngine',
        networkMode: 'hosted',
        hostedServerUrl: 'http://127.0.0.1:8787/',
        hostedAccessToken: 'understory-session',
        embeddingModel: 'must-not-enter-hosted-runtime',
        llmModel: 'must-not-enter-hosted-runtime',
        hostedRuntimeConfig: {
            features: {
                embedding: { model: 'must-be-ignored' },
                reasoning: { model: 'must-be-ignored' },
            },
        },
    };
    hostedRuntime._vaultBasePath = () => 'C:/Vault';
    const hostedEnv = hostedRuntime._pythonEnv();
    assert.strictEqual(hostedEnv.UNDERSTORY_NETWORK_MODE, 'hosted');
    assert.strictEqual(hostedEnv.UNDERSTORY_EMBEDDING_PROVIDER, 'hosted');
    assert.strictEqual(hostedEnv.UNDERSTORY_LLM_PROVIDER, 'hosted');
    assert.strictEqual(hostedEnv.UNDERSTORY_HOSTED_API_BASE_URL, 'http://127.0.0.1:8787/');
    assert.strictEqual(hostedEnv.UNDERSTORY_HOSTED_ACCESS_TOKEN, 'understory-session');
    assert.strictEqual(hostedEnv.UNDERSTORY_EMBEDDING_MODEL, undefined);
    assert.strictEqual(hostedEnv.UNDERSTORY_LLM_MODEL, undefined);

    const hostedClient = Object.create(hostedClientMethods);
    const sanitizedConfig = hostedClient._sanitizeRuntimeConfig({
        features: {
            embedding: {
                enabled: true,
                model: 'must-be-ignored',
                provider: 'must-be-ignored',
                endpoint: { method: 'POST', path: '/v1/embedding' },
            },
        },
    });
    assert.deepStrictEqual(sanitizedConfig.features.embedding, {
        enabled: true,
        endpoint: { method: 'POST', path: '/v1/embedding', url: '' },
    });

    const runtime = Object.create(runtimeMethods);
    runtime.settings = {};
    runtime.checkEngineHealth = async (showNotice) => {
        assert.strictEqual(showNotice, false);
        return { ok: true, issues: [], message: '' };
    };
    notices.length = 0;
    assert.strictEqual(await runtime._ensureEngineReady(true), true);
    assert.deepStrictEqual(notices, []);

    runtime.checkEngineHealth = async (showNotice) => {
        assert.strictEqual(showNotice, false);
        return { ok: false, issues: ['missing api.py'], message: 'missing api.py' };
    };
    notices.length = 0;
    assert.strictEqual(await runtime._ensureEngineReady(true), false);
    assert(notices.some((message) => /local engine is not ready/.test(message)));

    const store = new RelationsStore({
        app: { vault: { adapter: {} } },
        settings: {},
    });

    assert.deepStrictEqual(
        store._parseProcessJson('{"status":"ok","relations_count":1}\n'),
        { status: 'ok', relations_count: 1 }
    );
    assert.deepStrictEqual(
        store._parseProcessJson('warning: noisy dependency\n{"status":"ok","relations_count":2}\n'),
        { status: 'ok', relations_count: 2 }
    );
    assert.throws(() => store._parseProcessJson('warning only'), /Unexpected token|Empty stdout/);
    assert.strictEqual(store._emptyStore().version, 2);
    assert.deepStrictEqual(store._normalizeRisks({ risks: [{
        candidate_path: 'Folder/Target.md',
        type: 'possible_conflict',
        severity: 'medium',
        description: 'The dates differ.',
        source: 'hosted',
    }] }, 'Current.md'), [{
        candidate_path: 'Folder/Target.md',
        doc_a: 'Current.md',
        doc_b: 'Folder/Target.md',
        type: 'possible_conflict',
        severity: 'medium',
        description: 'The dates differ.',
        suggestion: '',
        status: 'open',
        source: 'hosted',
    }]);

    const target = new TFile('Folder/Target.md');
    const calls = [];
    const app = {
        vault: {
            getAbstractFileByPath(path) {
                return path === 'Folder/Target.md' ? target : null;
            },
        },
        workspace: {
            getLeaf(mode) {
                calls.push(['getLeaf', mode]);
                return {
                    openFile(file) {
                        calls.push(['openFile', file.path]);
                    },
                };
            },
        },
        metadataCache: {},
    };
    const view = new UnderstorySidebarView({ app }, { settings: {} });
    view.app = app;
    assert.strictEqual(view.getDisplayText(), 'Understory');
    assert.strictEqual(view.getIcon(), 'leaf');
    view._registerViewActions();
    assert.deepStrictEqual(
        view.actions.map((action) => [action.icon, action.title]),
        [
            ['leaf', 'Open Understory'],
            ['refresh-cw', 'Refresh Understory'],
            ['settings', 'Understory Settings'],
        ]
    );
    assert.strictEqual(
        view._groupRelations([{ title: 'A', status: 'suggested' }]).keys().next().value,
        'Possibly related'
    );
    const chineseView = new UnderstorySidebarView({ app }, { settings: { uiLanguage: 'zh' } });
    chineseView.app = app;
    assert.strictEqual(
        chineseView._groupRelations([{ title: 'A', status: 'suggested' }]).keys().next().value,
        '可能相关'
    );

    const relationRoot = makeFakeEl();
    view._renderRelationItem(relationRoot, target, {
        title: 'Related note',
        target: 'Folder/Target.md',
        status: 'suggested',
        source: 'hosted',
        score: 0.784,
    });
    const relationNodes = flattenFakeEl(relationRoot);
    assert(relationNodes.some((node) => node.text === '78% match'));
    assert(!relationNodes.some((node) => node.text === 'hosted'));

    view.plugin._conflictTypeName = () => 'Principle conflict';
    view.plugin.settings.sidebarShowConflicts = true;
    const conflictDescription = 'A'.repeat(180);
    const conflictRoot = makeFakeEl();
    view._renderConflicts(conflictRoot, target, [{
        doc_a: target.path,
        type: 'principle_conflict',
        severity: 'high',
        status: 'open',
        description: conflictDescription,
    }]);
    const conflictNodes = flattenFakeEl(conflictRoot);
    assert(conflictNodes.some((node) => node.text === 'Principle conflict \u00b7 Serious'));
    const conflictPreview = conflictNodes.find((node) => String(node.cls).includes('understory-sidebar-conflict-desc'));
    assert(conflictPreview.text.endsWith('\u2026'));
    assert.strictEqual(conflictPreview.title, conflictDescription);

    assert(!/cache/i.test(t({ settings: {} }, 'sidebar_cache_stale')));
    assert(!/cache/i.test(t({ settings: { uiLanguage: 'zh' } }, 'sidebar_cache_stale')));
    const staleRoot = makeFakeEl();
    const refreshCalls = [];
    view._refreshActiveFile = (file) => {
        refreshCalls.push(file.path);
    };
    view._renderStaleState(staleRoot, target);
    const staleNodes = flattenFakeEl(staleRoot);
    assert(staleNodes.some((node) => node.text === 'Suggestions need an update'));
    assert(staleNodes.some((node) => node.text === 'Update suggestions'));
    const staleButton = staleNodes.find((node) => node.tag === 'button');
    assert(staleButton);
    staleButton.listeners.click({ preventDefault() {} });
    assert.deepStrictEqual(refreshCalls, ['Folder/Target.md']);

    const missingRoot = makeFakeEl();
    view._renderStatePanel(missingRoot, 'missing', target);
    const missingNodes = flattenFakeEl(missingRoot);
    assert(missingNodes.some((node) => node.text === 'No suggestions yet'));
    assert(missingNodes.some((node) => node.text === 'Generate suggestions'));

    const scopeRoot = makeFakeEl();
    view._openSettings = (page) => {
        calls.push(['openSettings', page]);
    };
    view._renderScopeNotice(scopeRoot);
    const scopeNodes = flattenFakeEl(scopeRoot);
    assert(scopeNodes.some((node) => node.text === 'Outside automatic refresh'));
    assert(scopeNodes.some((node) => /full-vault/.test(node.text)));
    const scopeButton = scopeNodes.find((node) => node.tag === 'button');
    assert(scopeButton);
    await scopeButton.listeners.click({ preventDefault() {} });
    assert(calls.some((call) => call[0] === 'openSettings' && call[1] === 'scope'));
    calls.length = 0;

    view._openRelationTarget({ target: 'Folder/Target.md', title: 'Target' });

    assert.deepStrictEqual(calls, [
        ['getLeaf', 'tab'],
        ['openFile', 'Folder/Target.md'],
    ]);

    const commands = [];
    registerCoreCommands({
        settings: { networkMode: 'hosted' },
        addCommand(command) {
            commands.push(command);
        },
        openSidebar() {},
        linkNow() {},
        initIndex() {},
        toggleDaemon() {},
    });
    assert(commands.some((command) => command.id === 'open-sidebar'
        && command.name === 'Show Understory'));
    assert(commands.some((command) => command.id === 'auto-link-now'
        && command.name === 'Find related notes for current note'));
    assert(!commands.some((command) => command.id === 'init-embedding-index'));
    assert(!commands.some((command) => command.id === 'toggle-index-daemon'));

    const chineseCommands = [];
    registerCoreCommands({
        settings: { uiLanguage: 'zh', networkMode: 'local' },
        addCommand(command) {
            chineseCommands.push(command);
        },
        openSidebar() {},
        linkNow() {},
        initIndex() {},
        toggleDaemon() {},
    });
    assert(chineseCommands.some((command) => command.id === 'auto-link-now'
        && command.name === '为当前笔记找关联'));
    assert(chineseCommands.some((command) => command.id === 'toggle-index-daemon'
        && command.name === '启动/停止后台索引'));

    const englishCommands = [];
    registerCoreCommands({
        settings: { uiLanguage: 'en', networkMode: 'local' },
        addCommand(command) {
            englishCommands.push(command);
        },
        openSidebar() {},
        linkNow() {},
        initIndex() {},
        toggleDaemon() {},
    });
    assert(englishCommands.some((command) => command.id === 'auto-link-now'
        && command.name === 'Find related notes for current note'));
    assert(englishCommands.some((command) => command.id === 'toggle-index-daemon'
        && command.name === 'Start/stop background index'));
}

main().finally(() => {
    Module._load = originalLoad;
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
