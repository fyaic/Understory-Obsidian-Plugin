const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const { DEFAULT_SETTINGS, providerPreset, UnderstorySettingTab } = require('../src/settings');

function collectText(node, out = []) {
    if (!node) return out;
    if (node.text) out.push(String(node.text));
    if (node.textContent) out.push(String(node.textContent));
    if (node.options?.text) out.push(String(node.options.text));
    for (const child of node.children || []) collectText(child, out);
    return out;
}

function findAllByClass(node, className, out = []) {
    if (!node) return out;
    const classes = String(node.options?.cls || '').split(/\s+/);
    if (classes.includes(className)) out.push(node);
    for (const child of node.children || []) findAllByClass(child, className, out);
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

function createSettingsTab({ settings = {}, account, usage } = {}) {
    const app = {
        setting: { close() {} },
        workspace: { trigger() {} },
        vault: {
            adapter: { getBasePath: () => 'C:\\Vault' },
            configDir: '.obsidian',
            getFiles: () => [],
            getAllLoadedFiles: () => [],
        },
    };
    const disconnected = {
        status: 'disconnected',
        serverUrl: 'https://understory.bondie.io',
        accountCenterUrl: 'https://account.bondie.io/account',
        plan: '-',
        subscriptionStatus: '-',
        entitlementCount: 0,
        capabilityCount: 0,
        lastSync: 0,
    };
    const plugin = {
        app,
        manifest: { version: '1.13.1' },
        settings: {
            ...DEFAULT_SETTINGS,
            graphifyDir: '',
            pythonPath: 'python',
            linkLog: [],
            ...settings,
        },
        hostedUsageSummary: usage,
        hostedAccountSummary: () => account || disconnected,
        async saveSettings() {},
        async hostedLogin() {},
        async hostedRefreshStatus() {},
        async refreshHostedUsage() {},
        async hostedSwitchAccount() {},
        async hostedLogout() {},
        async hostedGlobalLogout() {},
        async hostedCancelLogin() {},
        async hostedStartCheckout() {},
        async hostedOpenBillingPortal() {},
        async runHostedAccountSmoke() {},
        async copyHostedAccountSmokeSummary() {},
        openHostedProfile() {},
        openHostedAccountSecurity() {},
        openHostedDevices() {},
        openHostedAccountCenter() {},
        async openSidebar() {},
        async checkEngineHealth() {
            this.engineHealth = { status: 'error', ok: false, message: 'No local engine folder selected' };
            return this.engineHealth;
        },
        async checkEmbeddingHealth() {
            this.embeddingHealth = { status: 'ok', semantic_state: 'local_only', indexing: 'skipped' };
            return this.embeddingHealth;
        },
        async initIndex() {},
        _countOpenConflicts: () => 0,
        _openConflictsView() {},
        _openOrphansView() {},
        _openGraphifyIndex() {},
        runLintAndGraph: async () => {},
        startRefreshQueue: async () => {},
        cancelRefresh: async () => {},
        startDaemon: async () => {},
        stopDaemon() {},
    };
    return new UnderstorySettingTab(app, plugin);
}

function connectedAccount(overrides = {}) {
    return {
        status: 'connected',
        plan: 'free',
        subscriptionStatus: 'active',
        providerAccessStatus: 'ready',
        lastSync: Date.UTC(2026, 6, 15, 2, 30),
        displayUser: {
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            picture: 'https://example.com/ada.png',
        },
        ...overrides,
    };
}

test('new hosted user sees one clear Bondie sign-in path and no provider setup', () => {
    const tab = createSettingsTab();

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Understory Settings/);
    assert.match(text, /Continue with Bondie/);
    assert.match(text, /Disconnected/);
    assert.equal(findAllByClass(tab.containerEl, 'understory-settings-nav').length, 0);
    assert.doesNotMatch(text, /API key|Python|Server URL|Local engine|Advanced/);
});

test('connected account renders identity, membership, managed AI status, and quick start', () => {
    const tab = createSettingsTab({ account: connectedAccount() });

    tab.display();
    const text = collectText(tab.containerEl).join('\n');
    const avatars = findAllByClass(tab.containerEl, 'understory-account-avatar');
    const avatarImage = avatars[0]?.children.find((child) => child.tag === 'img');

    assert.equal(avatarImage?.options?.attr?.src, 'https://example.com/ada.png');
    assert.match(text, /Ada Lovelace/);
    assert.match(text, /ada@example\.com/);
    assert.match(text, /Free/);
    assert.match(text, /Active/);
    assert.match(text, /Service ready/);
    assert.match(text, /Get started/);
    assert.match(text, /Open Understory/);
});

test('connected account without a picture gets a deterministic initials avatar', () => {
    const account = connectedAccount({
        displayUser: { name: 'Ada Lovelace', email: 'ada@example.com', picture: '' },
    });
    const tab = createSettingsTab({ account });

    tab.display();

    const initials = findAllByClass(tab.containerEl, 'understory-account-avatar-initials');
    assert.equal(initials[0]?.options?.text, 'AL');
});

test('connected navigation separates account, usage, workflow, scope, and advanced pages', () => {
    const tab = createSettingsTab({ account: connectedAccount() });

    tab.display();
    const nav = findAllByClass(tab.containerEl, 'understory-settings-nav')[0];
    const navText = collectText(nav).join('\n');

    for (const label of ['Account', 'Usage', 'Workflow', 'Scope', 'Suggestions', 'Activity', 'AI agents', 'Advanced']) {
        assert.match(navText, new RegExp(label));
    }
    assert.ok(navText.indexOf('Account') < navText.indexOf('Usage'));
    assert.ok(navText.indexOf('Usage') < navText.indexOf('Workflow'));

    findByText(nav, 'Usage').click();
    const usageText = collectText(tab.containerEl).join('\n');
    assert.match(usageText, /Usage/);
    assert.doesNotMatch(usageText, /Vector model key|Reasoning model key/);
});

test('usage page reports managed provider readiness and per-feature activity', () => {
    const tab = createSettingsTab({
        account: connectedAccount(),
        usage: {
            requests: 7,
            input_units: 1200,
            output_units: 240,
            provider_access: { status: 'ready' },
            by_feature: { relation_discovery: { requests: 5, input_units: 800, output_units: 120 } },
            last_used_at: '2026-07-15T02:30:00Z',
        },
    });
    tab._activeSettingsPage = 'usage';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Service ready/);
    assert.match(text, /7/);
    assert.match(text, /1,200/);
    assert.match(text, /Relation suggestions/);
});

test('hosted advanced page explains managed keys without exposing key inputs', () => {
    const tab = createSettingsTab({ account: connectedAccount() });
    tab._activeSettingsPage = 'advanced';

    tab.display();
    const text = collectText(tab.containerEl).join('\n');

    assert.match(text, /Advanced \/ Local & self-hosted/);
    assert.match(text, /Hosted accounts do not require OpenRouter, OpenAI, Zhipu, or custom provider keys/);
    assert.doesNotMatch(text, /Vector model key|Reasoning model key/);
});

test('advanced diagnostics stay behind one styled disclosure', () => {
    const tab = createSettingsTab({ account: connectedAccount() });
    tab._activeSettingsPage = 'advanced';

    tab.display();

    assert.equal(findAllByClass(tab.containerEl, 'understory-advanced-disclosure').length, 4);
    assert.equal(findAllByClass(tab.containerEl, 'understory-engine-panel').length, 1);

    const diagnostics = findAllByClass(tab.containerEl, 'understory-advanced-disclosure')
        .find((panel) => findByText(panel, 'Technical diagnostics'));
    assert.ok(diagnostics);
    assert.equal(diagnostics.open, false);
    diagnostics.open = true;
    diagnostics.dispatchEvent({ type: 'toggle', target: diagnostics });
    tab.display();
    const rerenderedDiagnostics = findAllByClass(tab.containerEl, 'understory-advanced-disclosure')
        .find((panel) => findByText(panel, 'Technical diagnostics'));
    assert.equal(rerenderedDiagnostics.open, true);

    const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    for (const selector of [
        '.understory-engine-panel',
        '.understory-engine-kv-grid',
        '.understory-engine-checks',
        '.understory-engine-command-row',
        '.understory-engine-panel > .setting-item .setting-item-control',
    ]) {
        assert.ok(styles.includes(selector), `missing ${selector} styles`);
    }
    assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.understory-settings-shell/);
});

test('public UI source avoids raw heading elements while preserving heading semantics', () => {
    const sourceFiles = [
        'hostedClient.js',
        'hostedDiscovery.js',
        'sidebarView.js',
        'graphifyViews.js',
    ];
    const sources = sourceFiles
        .map((filename) => fs.readFileSync(path.join(__dirname, '..', 'src', filename), 'utf8'))
        .join('\n');

    assert.doesNotMatch(sources, /createEl\(['"]h[1-6]['"]/);
    assert.match(sources, /role: 'heading', 'aria-level': '2'/);
    assert.match(sources, /role: 'heading', 'aria-level': '3'/);
    assert.equal((sources.match(/titleEl\.setText\(/g) || []).length, 2);
});

test('existing local user remains usable without a Bondie session', () => {
    const tab = createSettingsTab({
        settings: {
            networkMode: 'local',
            embeddingProvider: 'none',
            llmProvider: 'none',
            graphifyDir: 'C:\\Engine',
        },
    });

    tab.display();
    const text = collectText(tab.containerEl).join('\n');
    const navText = collectText(findAllByClass(tab.containerEl, 'understory-settings-nav')[0]).join('\n');

    assert.match(text, /Advanced \/ Local & self-hosted/);
    assert.match(text, /Local engine/);
    assert.match(text, /No cloud model or webhook requests/);
    assert.doesNotMatch(navText, /^Account$/m);
    assert.doesNotMatch(navText, /^Usage$/m);
    assert.doesNotMatch(text, /Continue with Bondie/);
});

test('Kimi presets use the documented regional endpoints and model', () => {
    const tab = createSettingsTab({ settings: { networkMode: 'full' } });

    assert.equal(providerPreset('kimi-cn').baseUrl, 'https://api.moonshot.cn/v1');
    assert.equal(providerPreset('kimi-cn').llmModel, 'kimi-k2.5');
    assert.equal(providerPreset('kimi-global').baseUrl, 'https://api.moonshot.ai/v1');
    assert.equal(providerPreset('kimi-global').llmModel, 'kimi-k2.5');

    tab._applyProviderPreset('llm', 'kimi-cn');
    assert.equal(tab.plugin.settings.llmProvider, 'kimi-cn');
    assert.equal(tab.plugin.settings.llmBaseUrl, 'https://api.moonshot.cn/v1');
    assert.equal(tab.plugin.settings.llmModel, 'kimi-k2.5');
});
