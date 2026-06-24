const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const UnderstoryPlugin = require('../src/main');
const { ensureBundledEngine, safePayloadParts } = require('../src/bundledEngine');

function payloadFile(relativePath, text) {
    const buffer = Buffer.from(text, 'utf8');
    return {
        path: relativePath,
        contentBase64: buffer.toString('base64'),
        sha256: require('node:crypto').createHash('sha256').update(buffer).digest('hex'),
    };
}

function createPayload() {
    return {
        version: 1,
        files: [
            payloadFile('api.py', 'print("understory")\n'),
            payloadFile('scripts/deploy_graphify.py', 'print("deploy")\n'),
            payloadFile('requirements.txt', 'pyyaml\n'),
        ],
    };
}

test('ensureBundledEngine writes payload files into the plugin folder', async (t) => {
    const pluginDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-plugin-'));
    t.after(() => fs.promises.rm(pluginDir, { recursive: true, force: true }));

    const result = await ensureBundledEngine({}, {
        pluginDir,
        payload: createPayload(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.files, 3);
    assert.equal(result.updated, 3);
    assert.equal(
        await fs.promises.readFile(path.join(result.engineDir, 'api.py'), 'utf8'),
        'print("understory")\n'
    );

    const second = await ensureBundledEngine({}, {
        pluginDir,
        payload: createPayload(),
    });
    assert.equal(second.updated, 0);
});

test('safePayloadParts rejects absolute and parent traversal paths', () => {
    assert.throws(() => safePayloadParts('../api.py'), /Unsafe bundled engine path/);
    assert.throws(() => safePayloadParts('C:/api.py'), /Unsafe bundled engine path/);
    assert.deepEqual(safePayloadParts('scripts/deploy_graphify.py'), ['scripts', 'deploy_graphify.py']);
});

test('onload installs bundled engine and saves it as the default engine path', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-vault-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));

    const app = {
        vault: {
            adapter: { getBasePath: () => root },
            configDir: '.obsidian',
            on(eventName, callback) {
                return { eventName, callback };
            },
            getAbstractFileByPath: () => null,
        },
        workspace: {
            onLayoutReady(callback) {
                callback();
            },
            getActiveFile: () => null,
            getLeavesOfType: () => [],
            getRightLeaf: () => null,
            revealLeaf() {},
        },
    };
    const originalWindow = global.window;
    global.window = {
        setTimeout: () => 0,
        setInterval: () => 0,
    };

    try {
        const plugin = new UnderstoryPlugin(app, { id: 'understory', version: 'test' });
        plugin.loadData = async () => ({});
        let healthChecks = 0;
        plugin.checkEngineHealth = async () => {
            healthChecks += 1;
            return { ok: true };
        };
        plugin.bundledEngineOptions = { payload: createPayload() };

        await plugin.onload();

        const expectedEngineDir = path.join(root, '.obsidian', 'plugins', 'understory', 'understory-graphify-engine');
        assert.equal(plugin.settings.graphifyDir, expectedEngineDir);
        assert.equal(plugin.savedData.graphifyDir, expectedEngineDir);
        assert.equal(await fs.promises.readFile(path.join(expectedEngineDir, 'api.py'), 'utf8'), 'print("understory")\n');
        assert.equal(healthChecks, 1);
    } finally {
        global.window = originalWindow;
    }
});
