/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const runtime = require('../src/graphifyRuntime');
const {
    REQUIRED_ENGINE_SCRIPTS,
    checkPathAccess,
    readEngineVersion,
} = require('../src/engineHealth');

const fakeSecrets = {
    embeddingApiKey: 'sk-test-engine-health-abcdefghijklmnopqrstuvwxyz',
    llmApiKey: 'sk-test-engine-health-llm-abcdefghijklmnopqrstuvwxyz',
    webhookUrl: 'https://hooks.example.test/services/T000/B000/ENGINESECRET',
};

function tempDir(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `understory-${name}-`));
}

function touch(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, '# test\n', 'utf8');
}

function createRuntimePlugin(settings = {}, options = {}) {
    const vaultBase = options.vaultBase || tempDir('vault');
    const plugin = Object.assign(Object.create(runtime), {
        manifest: { version: '9.9.9-test' },
        app: {
            vault: {
                adapter: { getBasePath: () => vaultBase },
                getAbstractFileByPath: () => null,
            },
            workspace: { getLeaf: () => ({ openFile: async () => {} }) },
        },
        settings: {
            graphifyDir: '',
            pythonPath: 'python',
            uiLanguage: 'en',
            linkLog: [],
            ...fakeSecrets,
            ...settings,
        },
        saveCount: 0,
        async saveSettings() {
            this.saveCount += 1;
        },
        _vaultBasePath() {
            return vaultBase;
        },
    });
    return plugin;
}

function createCompleteEngine() {
    const engineDir = tempDir('engine');
    for (const script of REQUIRED_ENGINE_SCRIPTS) {
        touch(path.join(engineDir, ...script.pathParts));
    }
    touch(path.join(engineDir, 'requirements.txt'));
    fs.mkdirSync(path.join(engineDir, '.git', 'refs', 'heads'), { recursive: true });
    fs.writeFileSync(path.join(engineDir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    fs.writeFileSync(path.join(engineDir, '.git', 'refs', 'heads', 'main'), '1234567890abcdef1234567890abcdef12345678\n', 'utf8');
    return engineDir;
}

test('readEngineVersion falls back to unknown version and reads git ref commit', () => {
    const engineDir = createCompleteEngine();
    const version = readEngineVersion(engineDir);

    assert.equal(version.version, 'unknown');
    assert.equal(version.commit, '1234567890ab');
});

test('checkPathAccess reports permission denial details', () => {
    const fsMock = {
        constants: fs.constants,
        existsSync: () => true,
        accessSync: () => {
            const error = new Error('denied');
            error.code = 'EACCES';
            throw error;
        },
    };

    const result = checkPathAccess('C:/locked', 'read', fsMock);

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'EACCES');
});

test('checkEngineHealth returns structured missing-dir diagnostics and redacts secrets', async () => {
    const plugin = createRuntimePlugin({ graphifyDir: '' });
    plugin._checkPythonVersion = async () => {
        throw new Error(`probe failed ${fakeSecrets.embeddingApiKey}`);
    };

    const result = await plugin.checkEngineHealth(false, true);

    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.pluginVersion, '9.9.9-test');
    assert.ok(result.issues.some((issue) => issue.id === 'engine.dir_missing'));
    assert.ok(result.issues.some((issue) => issue.id === 'engine.python_failed'));
    assert.equal(JSON.stringify(result).includes(fakeSecrets.embeddingApiKey), false);
    assert.equal(result.diagnosticText.includes(fakeSecrets.webhookUrl), false);
});

test('checkEngineHealth reports missing scripts as individual issues', async () => {
    const engineDir = tempDir('engine-missing-scripts');
    const plugin = createRuntimePlugin({ graphifyDir: engineDir });
    plugin._checkPythonVersion = async () => 'Python 3.12.0';

    const result = await plugin.checkEngineHealth(false, false);
    const issueIds = result.issues.map((issue) => issue.id);

    assert.equal(result.ok, false);
    assert.ok(issueIds.includes('engine.api_missing'));
    assert.ok(issueIds.includes('engine.deploy_missing'));
    assert.ok(result.checks.scripts.length > 0);
    assert.ok(result.checks.dependencies.some((item) => item.status === 'skipped'));
});

test('checkEngineHealth records dependency warnings without blocking engine readiness', async () => {
    const engineDir = createCompleteEngine();
    const vaultBase = tempDir('vault-ready');
    fs.mkdirSync(path.join(vaultBase, '.understory', 'scripts'), { recursive: true });
    const plugin = createRuntimePlugin({ graphifyDir: engineDir }, { vaultBase });
    plugin._checkPythonVersion = async () => 'Python 3.12.0';
    plugin._checkPythonModule = async (moduleName) => {
        if (moduleName === 'requests') {
            throw new Error(`No module named requests ${fakeSecrets.llmApiKey}`);
        }
        return `${moduleName} ok`;
    };

    const result = await plugin.checkEngineHealth(false, true);

    assert.equal(result.ok, true);
    assert.equal(result.status, 'warning');
    assert.ok(result.issues.some((issue) => issue.id === 'engine.dep_requests_missing'));
    assert.ok(result.fixes.some((issue) => String(issue.command || '').includes('pip install -r')));
    assert.equal(JSON.stringify(result).includes(fakeSecrets.llmApiKey), false);
});

test('_ensureEngineReady remains compatible with ok/message health contract', async () => {
    const plugin = createRuntimePlugin();
    plugin.checkEngineHealth = async () => ({ ok: false, message: 'not ready', issues: ['not ready'] });

    const ready = await plugin._ensureEngineReady(false);

    assert.equal(ready, false);
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
