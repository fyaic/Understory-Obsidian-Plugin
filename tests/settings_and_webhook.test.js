const assert = require('node:assert/strict');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const graphifyCore = require('../src/graphifyCore');
const linkDiscovery = require('../src/linkDiscovery');

const fakeSecrets = {
    embeddingApiKey: 'sk-test-embedding-abcdefghijklmnopqrstuvwxyz',
    llmApiKey: 'sk-test-llm-abcdefghijklmnopqrstuvwxyz',
    webhookUrl: 'https://hooks.example.test/services/T000/B000/SECRET',
};

function createLinkDiscoveryPlugin(persisted) {
    return Object.assign(Object.create(linkDiscovery), {
        loaded: persisted,
        settings: null,
        async loadData() {
            return this.loaded;
        },
        async saveData(data) {
            this.saved = data;
        },
        checkEngineHealth: async () => ({ ok: false }),
    });
}

function createCorePlugin(settings) {
    const calls = [];
    return {
        plugin: Object.assign(Object.create(graphifyCore), {
            settings: {
                lintInProgress: false,
                conflictBlockEnabled: false,
                presentationMode: 'sidebar',
                ...settings,
            },
            calls,
            _vaultBasePath: () => 'C:/vault',
            async _runPythonScript(scriptPath, args, timeoutMs) {
                calls.push({ scriptPath, args, timeoutMs });
                return '';
            },
            async saveSettings() {},
            _countOpenConflicts: () => 0,
            _shouldNotify: () => false,
        }),
        calls,
    };
}

test('loadSettings normalizes unsafe persisted settings', async () => {
    const plugin = createLinkDiscoveryPlugin({
        networkMode: 'invalid',
        webhookEnabled: true,
        webhookUrl: fakeSecrets.webhookUrl,
        embeddingProvider: 'invalid',
        llmProvider: 'invalid',
        lintInProgress: true,
        refreshInProgress: true,
        linkLog: [{
            status: 'error',
            errorDetail: `secret ${fakeSecrets.embeddingApiKey}`,
        }],
    });

    await plugin.loadSettings();

    assert.equal(plugin.settings.networkMode, 'local');
    assert.equal(plugin.settings.webhookEnabled, false);
    assert.equal(plugin.settings.embeddingProvider, 'zhipu');
    assert.equal(plugin.settings.llmProvider, 'zhipu');
    assert.equal(plugin.settings.lintInProgress, false);
    assert.equal(plugin.settings.refreshInProgress, false);
    assert.equal(JSON.stringify(plugin.settings.linkLog).includes(fakeSecrets.embeddingApiKey), false);
});

test('runLintAndGraph does not pass webhook args in local mode', async () => {
    const { plugin, calls } = createCorePlugin({
        networkMode: 'local',
        webhookEnabled: true,
        webhookUrl: fakeSecrets.webhookUrl,
        webhookType: 'slack',
    });

    await plugin.runLintAndGraph(true);

    const notify = calls.find((call) => call.scriptPath.endsWith('notification_manager.py'));
    assert.ok(notify);
    assert.deepEqual(notify.args, ['--vault', 'C:/vault']);
});

test('runLintAndGraph passes webhook args only when non-local and explicitly enabled', async () => {
    const { plugin, calls } = createCorePlugin({
        networkMode: 'full',
        webhookEnabled: true,
        webhookUrl: fakeSecrets.webhookUrl,
        webhookType: 'slack',
    });

    await plugin.runLintAndGraph(true);

    const notify = calls.find((call) => call.scriptPath.endsWith('notification_manager.py'));
    assert.ok(notify);
    assert.deepEqual(notify.args, [
        '--vault',
        'C:/vault',
        '--webhook',
        fakeSecrets.webhookUrl,
        '--webhook-type',
        'slack',
        '--webhook-enabled',
    ]);
});
