const assert = require('node:assert/strict');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const { DEFAULT_SETTINGS, UnderstorySettingTab } = require('../src/settings');

function collectText(node, out = []) {
    if (!node) return out;
    if (node.text) out.push(String(node.text));
    if (node.textContent) out.push(String(node.textContent));
    if (node.options && node.options.text) out.push(String(node.options.text));
    for (const child of node.children || []) collectText(child, out);
    return out;
}

function findByText(node, text) {
    if (!node) return null;
    if (node.text === text || node.textContent === text || node.options?.text === text) return node;
    for (const child of node.children || []) {
        const match = findByText(child, text);
        if (match) return match;
    }
    return null;
}

function findByAttribute(node, name, value) {
    if (!node) return null;
    if (node.attributes?.[name] === value) return node;
    for (const child of node.children || []) {
        const match = findByAttribute(child, name, value);
        if (match) return match;
    }
    return null;
}

function findByClass(node, className) {
    if (!node) return null;
    const classes = String(node.options?.cls || '').split(/\s+/);
    if (classes.includes(className)) return node;
    for (const child of node.children || []) {
        const match = findByClass(child, className);
        if (match) return match;
    }
    return null;
}

function createSettingsTab(settings = {}, health = null) {
    const app = {
        workspace: { trigger() {} },
        vault: {
            adapter: { getBasePath: () => 'C:\\Vault' },
            getFiles: () => [],
            getAllLoadedFiles: () => [],
        },
    };
    const plugin = {
        app,
        manifest: { version: '1.7.2' },
        settings: {
            ...DEFAULT_SETTINGS,
            graphifyDir: '',
            pythonPath: 'python',
            linkLog: [],
            ...settings,
        },
        engineHealth: health,
        async saveSettings() {},
        async checkEngineHealth() {
            this.engineHealth = health || { status: 'error', ok: false, message: 'No local engine folder selected' };
            return this.engineHealth;
        },
        async openSidebar() {},
        _countOpenConflicts: () => 0,
        _openConflictsView() {},
        _openOrphansView() {},
        _openGraphifyIndex() {},
        runLintAndGraph: async () => {},
        checkAndStartRefresh: async () => {},
        startRefreshQueue: async () => {},
        cancelRefresh: async () => {},
        startDaemon: async () => {},
        stopDaemon() {},
    };
    return new UnderstorySettingTab(app, plugin);
}

test('settings default page shows onboarding tabs without technical matrix', () => {
    const tab = createSettingsTab();

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    const logo = findByClass(tab.containerEl, 'understory-settings-logo');
    assert.ok(logo);
    assert.match(logo.attributes.src, /^data:image\/png;base64,/);
    assert.equal(logo.attributes.alt, 'Understory logo');
    const languageIcon = findByClass(tab.containerEl, 'understory-language-toggle-icon');
    assert.equal(languageIcon.attributes['data-icon'], 'globe-2');

    assert.match(text, /Understory Settings/);
    assert.match(text, /Start here/);
    assert.match(text, /Network & privacy/);
    assert.match(text, /Relation discovery/);
    assert.match(text, /Relation maintenance/);
    assert.match(text, /AI agents/);
    assert.ok(text.indexOf('Relation discovery') < text.indexOf('Relation maintenance'));
    assert.ok(text.indexOf('Relation maintenance') < text.indexOf('AI agents'));
    assert.match(text, /Choose the local engine folder/);
    assert.doesNotMatch(text, /🌱/);
    assert.doesNotMatch(text, /🌐/);
    assert.doesNotMatch(text, /Versions/);
    assert.doesNotMatch(text, /Check matrix/);
    assert.doesNotMatch(text, /Open sidebar on startup/);
});

test('agent access tab shows MCP config and Understory Skill together', () => {
    const tab = createSettingsTab({
        graphifyDir: 'C:\\Engine',
        pythonPath: 'C:\\Python\\python.exe',
    });
    tab._activeSettingsTab = 'agents';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Agent access for AI agents/);
    assert.match(text, /Current vault/);
    assert.match(text, /Vault name/);
    assert.match(text, /MCP server key/);
    assert.match(text, /understory-vault/);
    assert.match(text, /Choose use case/);
    assert.match(text, /Selected use case: Agent memory model/);
    assert.match(text, /Choose agent/);
    assert.match(text, /Selected profile: Generic MCP/);
    assert.match(text, /Prepare local MCP file/);
    assert.match(text, /Create local MCP server file/);
    assert.match(text, /Install in your agent/);
    assert.match(text, /MCP JSON \(paste into agent MCP settings\)/);
    assert.match(text, /Copy MCP JSON/);
    assert.match(text, /Skill prompt \(paste into agent\)/);
    assert.match(text, /Copy Skill prompt/);
    assert.match(text, /understory-mcp-server\.js/);
    assert.match(text, /active local context and a long-term memory layer/);
    assert.match(text, /This Skill is only for this vault/);
    assert.match(text, /Copy full setup pack/);
    assert.match(text, /Multi-vault setup/);
    assert.match(text, /Open the target vault/);
    assert.match(text, /Create the local MCP file/);
    assert.match(text, /Add this vault to the agent/);
    assert.match(text, /Do not scan the entire vault by default/);
    assert.match(text, /🔒 MCP uses local stdio/);
    assert.match(text, /🌿 Vault data/);
    assert.match(text, /✍️ The Skill defaults to read-only behavior/);

    const identityList = findByClass(tab.containerEl, 'understory-agent-identity-list');
    assert.ok(identityList);
    assert.ok(findByClass(identityList, 'understory-agent-quote-block'));
    assert.ok(findByClass(identityList, 'understory-agent-identity-row'));
    assert.equal(findByClass(tab.containerEl, 'understory-agent-status-card'), null);
    assert.equal(findByClass(tab.containerEl, 'understory-agent-safety'), null);

    assert.doesNotMatch(text, /Export MCP server/);
    assert.doesNotMatch(text, /sk-[a-z0-9]/i);
});

test('agent access tab follows Chinese UI language', () => {
    const tab = createSettingsTab({
        uiLanguage: 'zh',
        graphifyDir: 'C:\\Engine',
    });
    tab._activeSettingsTab = 'agents';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Agent访问/);
    assert.match(text, /当前 vault/);
    assert.match(text, /MCP server key/);
    assert.match(text, /选择用途/);
    assert.match(text, /当前用途：Agent memory model/);
    assert.match(text, /选择 Agent/);
    assert.match(text, /当前 profile：通用 MCP/);
    assert.match(text, /通用 MCP：把这段 JSON 粘贴到任何支持 stdio 的 MCP 客户端/);
    assert.match(text, /准备本地 MCP 文件/);
    assert.match(text, /创建本地 MCP server 文件/);
    assert.match(text, /MCP JSON（复制到 Agent 的 MCP 设置）/);
    assert.match(text, /复制 MCP JSON/);
    assert.match(text, /Skill prompt（复制给 Agent）/);
    assert.match(text, /复制 Skill prompt/);
    assert.match(text, /多 vault 设置/);
    assert.match(text, /打开目标 vault/);
    assert.match(text, /创建本地 MCP 文件/);
    assert.match(text, /复制到同一个 Agent/);
    assert.match(text, /🔒 MCP 使用本地 stdio/);
    assert.match(text, /🌿 不向 Bondie Labs 发送/);
    assert.match(text, /✍️ Skill 默认只读/);
    assert.match(text, /主动获取上下文/);
    assert.doesNotMatch(text, /Generic MCP: Paste this JSON/);
    assert.doesNotMatch(text, /代理/);
});

test('agent access tab changes install notes by selected profile', () => {
    const tab = createSettingsTab({
        agentProfileId: 'claude',
        graphifyDir: 'C:\\Engine',
    });
    tab._activeSettingsTab = 'agents';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Selected profile: Claude Desktop/);
    assert.match(text, /Claude Desktop: Paste the server entry/);
    assert.match(text, /understory-vault/);

    const notes = findByClass(tab.containerEl, 'understory-agent-install-notes');
    assert.ok(notes);
    assert.ok(findByClass(notes, 'understory-agent-quote-block'));
    assert.match(collectText(notes).join('\n'), /Claude Desktop: Paste the server entry/);

    const firstPreview = findByClass(tab.containerEl, 'understory-agent-preview');
    assert.ok(firstPreview);
    assert.doesNotMatch(collectText(firstPreview).join('\n'), /Claude Desktop: Paste the server entry/);
});

test('agent access tab changes Skill preview by selected usage mode', () => {
    const tab = createSettingsTab({
        agentUsageModeId: 'query',
        graphifyDir: 'C:\\Engine',
    });
    tab._activeSettingsTab = 'agents';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Selected use case: Query-only/);
    assert.match(text, /when the user explicitly asks to query, search, cite, summarize, or inspect/);
    assert.match(text, /Treat Query-only mode as read-only/);
    assert.doesNotMatch(text, /retrieve relevant Understory context early/);
});

test('settings page toggle keeps relation maintenance next to discovery before agents', () => {
    const tab = createSettingsTab();

    tab.display();

    const tablist = findByAttribute(tab.containerEl, 'role', 'tablist');
    assert.ok(tablist);
    assert.equal(tablist.attributes['aria-label'], 'Settings pages');

    const setupButton = findByText(tab.containerEl, 'Start here');
    const discoveryButton = findByText(tab.containerEl, 'Relation discovery');
    const maintenanceButton = findByText(tab.containerEl, 'Relation maintenance');
    const agentsButton = findByText(tab.containerEl, 'AI agents');
    assert.equal(setupButton.attributes.role, 'tab');
    assert.equal(setupButton.attributes['aria-selected'], 'true');
    assert.equal(discoveryButton.attributes.role, 'tab');
    assert.equal(maintenanceButton.attributes.role, 'tab');
    assert.equal(maintenanceButton.attributes['aria-selected'], 'false');
    assert.equal(agentsButton.attributes.role, 'tab');

    const tabText = collectText(tablist).join('\n');
    assert.ok(tabText.indexOf('Relation discovery') < tabText.indexOf('Relation maintenance'));
    assert.ok(tabText.indexOf('Relation maintenance') < tabText.indexOf('AI agents'));

    maintenanceButton.click();
    let text = collectText(tab.containerEl).join('\n');
    assert.match(text, /Relation maintenance/);
    assert.match(text, /Technical diagnostics/);
    assert.match(text, /Versions/);

    const setupButtonAfterSwitch = findByText(tab.containerEl, 'Start here');
    assert.equal(setupButtonAfterSwitch.attributes['aria-selected'], 'false');
    const maintenanceButtonAfterSwitch = findByText(tab.containerEl, 'Relation maintenance');
    assert.equal(maintenanceButtonAfterSwitch.attributes['aria-selected'], 'true');

    setupButtonAfterSwitch.click();
    text = collectText(tab.containerEl).join('\n');
    assert.match(text, /Choose the local engine folder/);
    assert.doesNotMatch(text, /Check matrix/);
});

test('models tab hides provider fields in local mode', () => {
    const tab = createSettingsTab({ networkMode: 'local' });
    tab._activeSettingsTab = 'models';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Network and privacy/);
    assert.match(text, /Model services/);
    assert.match(text, /Cloud model settings are hidden because Local only is selected/);
    assert.doesNotMatch(text, /Vector model provider/);
    assert.doesNotMatch(text, /Vector model API key/);
    assert.doesNotMatch(text, /Endpoint \/ Base URL/);
    assert.equal(findByClass(tab.containerEl, 'understory-privacy-callout'), null);
});

test('models tab shows vector provider key and endpoint fields in vector mode', () => {
    const tab = createSettingsTab({ networkMode: 'embedding', embeddingProvider: 'openai' });
    tab._activeSettingsTab = 'models';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Vector model provider/);
    assert.match(text, /Vector model API key/);
    assert.match(text, /Endpoint \/ Base URL/);
    assert.match(text, /Vector model name/);
    assert.match(text, /Only the vector model is enabled right now/);
    assert.doesNotMatch(text, /Reasoning model provider/);
});

test('models tab shows reasoning provider key and endpoint fields in full mode', () => {
    const tab = createSettingsTab({ networkMode: 'full', embeddingProvider: 'openai', llmProvider: 'zhipu' });
    tab._activeSettingsTab = 'models';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Vector model API key/);
    assert.match(text, /Reasoning model provider/);
    assert.match(text, /Reasoning model API key/);
    assert.match(text, /Endpoint \/ Base URL/);
    assert.match(text, /Full AI analysis can also use a reasoning model/);
});

test('maintenance tab keeps technical diagnostics available', () => {
    const tab = createSettingsTab({}, {
        status: 'error',
        ok: false,
        message: 'No local engine folder selected',
        pluginVersion: '1.7.2',
        engineVersion: 'unknown',
        engineCommit: 'unknown',
        pythonPath: 'python',
        pythonVersion: 'Python 3.12.7',
        vaultUnderstoryPath: 'C:/vault/.understory',
        checks: {
            paths: [{ status: 'error', label: 'Engine folder', detail: 'Missing folder' }],
            dependencies: [{ status: 'ok', label: 'Python', detail: 'Python 3.12.7' }],
        },
        fixes: [{ severity: 'error', title: 'No local engine folder selected', fix: 'Choose the engine folder.' }],
        diagnosticText: 'Understory engine diagnostics',
    });
    tab._activeSettingsTab = 'maintenance';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Technical diagnostics/);
    assert.match(text, /Versions/);
    assert.match(text, /Check matrix/);
});
