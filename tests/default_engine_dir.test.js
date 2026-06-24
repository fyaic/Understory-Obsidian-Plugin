const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const { getDefaultEngineDir, isLikelyEngineDir } = require('../src/settings');

async function makeEngine(root, name = 'understory-graphify-engine') {
    const engineDir = path.join(root, name);
    await fs.promises.mkdir(path.join(engineDir, 'scripts'), { recursive: true });
    await fs.promises.writeFile(path.join(engineDir, 'api.py'), '');
    await fs.promises.writeFile(path.join(engineDir, 'scripts', 'deploy_graphify.py'), '');
    return engineDir;
}

test('getDefaultEngineDir prefers explicit environment values', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-engine-default-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    await makeEngine(root);

    assert.equal(getDefaultEngineDir({
        env: { UNDERSTORY_ENGINE_DIR: 'C:\\Custom\\Engine' },
        searchRoots: [root],
        includeDefaultRoots: false,
    }), 'C:\\Custom\\Engine');
});

test('getDefaultEngineDir discovers a sibling Understory engine folder', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-engine-default-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const pluginDir = path.join(root, 'Understory-Obsidian-Plugin', 'src');
    await fs.promises.mkdir(pluginDir, { recursive: true });
    const engineDir = await makeEngine(root);

    assert.equal(getDefaultEngineDir({
        env: {},
        pluginDir,
        includeDefaultRoots: false,
    }), engineDir);
});

test('getDefaultEngineDir ignores folders that do not look like the engine', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-engine-default-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const fakeDir = path.join(root, 'understory-graphify-engine');
    await fs.promises.mkdir(fakeDir, { recursive: true });

    assert.equal(isLikelyEngineDir(fakeDir), false);
    assert.equal(getDefaultEngineDir({
        env: {},
        searchRoots: [root],
        includeDefaultRoots: false,
    }), '');
});
