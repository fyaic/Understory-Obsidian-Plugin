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
        plugin.loadData = async () => ({ networkMode: 'local', settingsSchemaVersion: 1 });
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

test('openSidebar creates and reveals only a right sidebar leaf', async () => {
    const originalWindow = global.window;
    global.window = {
        setTimeout: () => 0,
        setInterval: () => 0,
    };
    let rightLeafCalls = 0;
    let genericLeafCalls = 0;
    let revealTarget = null;
    const setStates = [];
    let detachedWrongLeaf = false;
    const wrongLeaf = {
        getRoot: () => ({ side: 'left' }),
        detach: async () => {
            detachedWrongLeaf = true;
        },
    };
    const rightLeaf = {
        setViewState: async (state) => {
            setStates.push(state);
        },
    };
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
                callback();
            },
            getActiveFile: () => null,
            getLeavesOfType: () => [wrongLeaf],
            getRightLeaf: () => {
                rightLeafCalls += 1;
                return rightLeaf;
            },
            getLeaf: () => {
                genericLeafCalls += 1;
                return {};
            },
            revealLeaf(leaf) {
                revealTarget = leaf;
            },
        },
    };
    const plugin = new UnderstoryPlugin(app, { version: 'test' });
    plugin.loadData = async () => ({});
    plugin.checkEngineHealth = async () => ({ ok: false });

    try {
        await plugin.onload();
        await plugin.openSidebar();

        assert.equal(rightLeafCalls, 1);
        assert.equal(genericLeafCalls, 0);
        assert.equal(revealTarget, rightLeaf);
        assert.equal(detachedWrongLeaf, true);
        assert.deepEqual(setStates, [{ type: 'understory-sidebar', active: true }]);
    } finally {
        global.window = originalWindow;
    }
});

test('openSidebar reuses an existing right sidebar leaf without creating another', async () => {
    const originalWindow = global.window;
    global.window = {
        setTimeout: () => 0,
        setInterval: () => 0,
    };
    let rightLeafCalls = 0;
    let revealTarget = null;
    const rightRoot = { side: 'right' };
    const existingRightLeaf = {
        getRoot: () => rightRoot,
        setViewState: async () => {
            throw new Error('existing right sidebar leaf should not be overwritten');
        },
    };
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
                callback();
            },
            getActiveFile: () => null,
            getLeavesOfType: () => [existingRightLeaf],
            getRightLeaf: () => {
                rightLeafCalls += 1;
                return null;
            },
            revealLeaf(leaf) {
                revealTarget = leaf;
            },
        },
    };
    const plugin = new UnderstoryPlugin(app, { version: 'test' });
    plugin.loadData = async () => ({});
    plugin.checkEngineHealth = async () => ({ ok: false });

    try {
        await plugin.onload();
        await plugin.openSidebar();

        assert.equal(rightLeafCalls, 0);
        assert.equal(revealTarget, existingRightLeaf);
    } finally {
        global.window = originalWindow;
    }
});
