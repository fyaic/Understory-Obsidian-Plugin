const assert = require('node:assert/strict');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const UnderstoryPlugin = require('../src/main');

test('onload defers vault event listeners until workspace layout is ready', async () => {
    const layoutCallbacks = [];
    const vaultEvents = [];
    const originalWindow = global.window;
    global.window = {
        setTimeout: () => 0,
        setInterval: () => 0,
    };

    try {
        const app = {
            vault: {
                adapter: { getBasePath: () => 'C:/vault' },
                on(eventName, callback) {
                    vaultEvents.push(eventName);
                    return { eventName, callback };
                },
                getAbstractFileByPath: () => null,
            },
            workspace: {
                onLayoutReady(callback) {
                    layoutCallbacks.push(callback);
                },
                getActiveFile: () => null,
                getLeavesOfType: () => [],
                getRightLeaf: () => ({ setViewState: async () => {} }),
                revealLeaf() {},
            },
        };
        const plugin = new UnderstoryPlugin(app, { version: 'test' });
        plugin.checkEngineHealth = async () => ({ ok: false });

        await plugin.onload();

        assert.equal(typeof plugin.agentApi.status, 'function');
        assert.equal(typeof plugin.agentApi.getRelations, 'function');

        assert.deepEqual(vaultEvents, []);
        assert.equal(layoutCallbacks.length, 2);

        for (const callback of layoutCallbacks) callback();

        assert.deepEqual(vaultEvents.sort(), ['create', 'create', 'delete', 'modify', 'rename']);
    } finally {
        global.window = originalWindow;
    }
});
