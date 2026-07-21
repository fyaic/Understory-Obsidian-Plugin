/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const {
    findDefaultPythonPath,
    getDefaultEngineDir,
    getDefaultPythonPath,
    isLikelyEngineDir,
    repairPythonPath,
} = require('../src/settings');

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

function pythonSpawnMock(availableCommands) {
    const available = new Set(availableCommands);
    return (command) => {
        if (available.has(command)) {
            return { status: 0, stdout: 'Python 3.14.3\n', stderr: '' };
        }
        return { status: null, error: new Error(`${command}: command not found`) };
    };
}

test('getDefaultPythonPath discovers Homebrew python3 on macOS when python is missing', () => {
    const options = {
        platform: 'darwin',
        env: {},
        spawnSync: pythonSpawnMock(['/opt/homebrew/bin/python3']),
    };

    assert.equal(findDefaultPythonPath(options), '/opt/homebrew/bin/python3');
    assert.equal(getDefaultPythonPath(options), '/opt/homebrew/bin/python3');
});

test('repairPythonPath replaces a saved python command that is not executable', () => {
    const settings = { pythonPath: 'python' };
    const result = repairPythonPath(settings, {
        platform: 'darwin',
        env: {},
        spawnSync: pythonSpawnMock(['/opt/homebrew/bin/python3']),
    });

    assert.equal(result.changed, true);
    assert.equal(settings.pythonPath, '/opt/homebrew/bin/python3');
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument -- End CommonJS audit bridge. */
