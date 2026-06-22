const assert = require('node:assert/strict');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const UnderstoryPlugin = require('../src/main');

test('onload defers vault event listeners until workspace layout is ready', async () => {
    const layoutCallbacks = [];
    const vaultEvents = [];
    let rightLeafCalls = 0;
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
                getRightLeaf: () => {
                    rightLeafCalls += 1;
                    return { setViewState: async () => {} };
                },
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
        assert.equal(rightLeafCalls, 0);
    } finally {
        global.window = originalWindow;
    }
});

test('onload does not open the sidebar even if old settings opted in', async () => {
    const layoutCallbacks = [];
    let rightLeafCalls = 0;
    let revealCalls = 0;
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
                getRightLeaf: () => {
                    rightLeafCalls += 1;
                    return { setViewState: async () => {} };
                },
                revealLeaf() {
                    revealCalls += 1;
                },
            },
        };
        const plugin = new UnderstoryPlugin(app, { version: 'test' });
        plugin.loadData = async () => ({ openSidebarOnLoad: true });
        plugin.checkEngineHealth = async () => ({ ok: false });

        await plugin.onload();
        for (const callback of layoutCallbacks) await callback();

        assert.equal(rightLeafCalls, 0);
        assert.equal(revealCalls, 0);
    } finally {
        global.window = originalWindow;
    }
});
