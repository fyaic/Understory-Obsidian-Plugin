const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { installMockObsidian, obsidianMock } = require('./helpers/mockObsidian');
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

test('initIndex uses api.py init status and does not fake success for unavailable provider', async () => {
    obsidianMock.Notice.instances.length = 0;
    let receivedArgs = null;
    let refreshed = false;
    const plugin = Object.assign(Object.create(linkDiscovery), {
        settings: { uiLanguage: 'en' },
        _ensureEngineReady: async () => true,
        _vaultBasePath: () => 'C:/vault',
        _runEngineApi: async (args) => {
            receivedArgs = args;
            return {
                payload: {
                    status: 'error',
                    indexing: 'unavailable',
                    message: 'missing embedding API key',
                },
            };
        },
        checkEmbeddingHealth: async () => {
            refreshed = true;
            return { status: 'warning' };
        },
    });

    await plugin.initIndex();

    assert.deepEqual(receivedArgs, ['init', '--vault', 'C:/vault']);
    assert.equal(refreshed, true);
    const messages = obsidianMock.Notice.instances.map((notice) => notice.message).join('\n');
    assert.match(messages, /semantic index cannot be built yet: missing embedding API key/);
    assert.doesNotMatch(messages, /local semantic index is ready/);
});

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

test('loadSettings normalizes unsafe persisted settings to hosted-safe defaults', async () => {
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

    assert.equal(plugin.settings.networkMode, 'hosted');
    assert.equal(plugin.settings.webhookEnabled, false);
    assert.equal(plugin.settings.embeddingProvider, 'hosted');
    assert.equal(plugin.settings.llmProvider, 'hosted');
    assert.equal(plugin.settings.lintInProgress, false);
    assert.equal(plugin.settings.refreshInProgress, false);
    assert.equal(JSON.stringify(plugin.settings.linkLog).includes(fakeSecrets.embeddingApiKey), false);
});

test('loadSettings defaults suggestions to right sidebar only', async () => {
    const plugin = createLinkDiscoveryPlugin({});

    await plugin.loadSettings();

    assert.equal(plugin.settings.presentationMode, 'sidebar');
});

test('_runGraphifyProcess defaults to no auto-write', async () => {
    const childProcess = require('child_process');
    const originalSpawn = childProcess.spawn;
    let receivedArgs = null;
    let stripped = false;
    childProcess.spawn = (_pythonExe, args) => {
        receivedArgs = args;
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.killed = false;
        proc.kill = () => { proc.killed = true; };
        process.nextTick(() => {
            proc.stdout.emit('end');
            proc.stderr.emit('end');
            proc.emit('close', 0);
        });
        return proc;
    };
    const plugin = Object.assign(Object.create(linkDiscovery), {
        app: {
            vault: {
                adapter: { getFullPath: (filePath) => `C:/vault/${filePath}` },
            },
        },
        settings: {
            graphifyDir: 'C:/engine',
            pythonPath: 'python',
        },
        timers: new Map(),
        _ensureEngineReady: async () => true,
        _enginePath: (name) => `C:/engine/${name}`,
        _vaultBasePath: () => 'C:/vault',
        _maybeProcessResult: async () => {},
        relationsStore: {
            stripAutoRelatedSection: async () => { stripped = true; },
        },
    });

    try {
        await plugin._runGraphifyProcess({ path: 'Notes/A.md' }, false);
    } finally {
        childProcess.spawn = originalSpawn;
    }

    assert.ok(receivedArgs);
    assert.ok(receivedArgs.includes('--no-auto-write'));
    assert.equal(receivedArgs.includes('--auto-write'), false);
    assert.equal(stripped, true);
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
