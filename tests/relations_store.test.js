const assert = require('node:assert/strict');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
const { TFile } = installMockObsidian();

const { OVERRIDES_PATH, RELATIONS_PATH, RelationsStore } = require('../src/relationsStore');

function createHarness() {
    const noteFiles = new Map();
    const dataFiles = new Map();
    const dirs = new Set();
    const tFiles = new Map();
    const events = [];

    const adapter = {
        async exists(path) {
            return dirs.has(path) || dataFiles.has(path);
        },
        async mkdir(path) {
            dirs.add(path);
        },
        async read(path) {
            if (!dataFiles.has(path)) throw new Error(`missing ${path}`);
            return dataFiles.get(path);
        },
        async write(path, content) {
            dataFiles.set(path, content);
        },
        getFullPath(path) {
            return `C:/vault/${path}`;
        },
    };

    const app = {
        vault: {
            adapter,
            async read(file) {
                return noteFiles.get(file.path) || '';
            },
            async modify(file, content) {
                noteFiles.set(file.path, content);
            },
            getAbstractFileByPath(path) {
                return tFiles.get(path) || null;
            },
        },
        workspace: {
            trigger(...args) {
                events.push(args);
            },
        },
    };

    const plugin = { app, settings: { uiLanguage: 'en' } };
    const store = new RelationsStore(plugin);
    const file = new TFile('Notes/Source.md');
    file.stat.mtime = 1000;
    tFiles.set(file.path, file);
    noteFiles.set(file.path, 'source note body');

    return { dataFiles, events, file, noteFiles, store };
}

test('_parseProcessJson parses plain JSON and mixed stdout JSON lines', () => {
    const { store } = createHarness();

    assert.deepEqual(store._parseProcessJson('{"status":"ok","relations":[]}'), {
        status: 'ok',
        relations: [],
    });
    assert.deepEqual(store._parseProcessJson('log line\n{"status":"ok","relations_count":1}\n'), {
        status: 'ok',
        relations_count: 1,
    });
    assert.deepEqual(store._parseProcessJson('prefix {"status":"ok","value":2} suffix'), {
        status: 'ok',
        value: 2,
    });
    assert.throws(() => store._parseProcessJson('log line without json'));
});

test('updateFromResult writes normalized relations and getRelations reports missing, ok, and stale', async () => {
    const { dataFiles, file, noteFiles, store } = createHarness();

    const missing = await store.getRelations('Notes/Missing.md');
    assert.equal(missing.status, 'missing');
    assert.equal(missing.stale, true);

    const entry = await store.updateFromResult(file, {
        status: 'ok',
        grouped: { concept: ['Target'] },
        relations: [{
            title: 'Target',
            path: 'Notes/Target.md',
            score: 0.91,
            source: 'semantic',
        }],
    });

    assert.equal(entry.relations.length, 1);
    assert.equal(entry.relations[0].target, 'Notes/Target.md');
    assert.equal(entry.relations[0].status, 'suggested');
    assert.ok(dataFiles.has(RELATIONS_PATH));

    const current = await store.getRelations(file);
    assert.equal(current.status, 'ok');
    assert.equal(current.stale, false);
    assert.equal(current.relations[0].title, 'Target');

    noteFiles.set(file.path, 'changed source note body');
    const stale = await store.getRelations(file);
    assert.equal(stale.status, 'ok');
    assert.equal(stale.stale, true);
});

test('accept and reject update relation status and tombstone rejected targets', async () => {
    const { dataFiles, file, store } = createHarness();
    await store.updateFromResult(file, {
        status: 'ok',
        relations: [{ title: 'Target', path: 'Notes/Target.md' }],
    });

    assert.equal(await store.accept(file.path, 'Target'), true);
    let persisted = JSON.parse(dataFiles.get(RELATIONS_PATH));
    assert.equal(persisted.files[file.path].relations[0].status, 'accepted');

    assert.equal(await store.reject(file.path, 'Target'), true);
    persisted = JSON.parse(dataFiles.get(RELATIONS_PATH));
    const overrides = JSON.parse(dataFiles.get(OVERRIDES_PATH));
    assert.equal(persisted.files[file.path].relations[0].status, 'rejected');
    assert.equal(overrides[file.path].tombstones.Target.action, 'deleted');
});

test('stripAutoRelatedSection removes auto-generated related section but keeps manual section', async () => {
    const { file, noteFiles, store } = createHarness();
    const plugin = store.plugin;

    // Manual section (no auto-links sentinel) should stay.
    noteFiles.set(file.path, '# Note\n\n## 🏷️关联文件\n\n### 手动插入\n\n[[Manual]]\n');
    assert.equal(await store.stripAutoRelatedSection(file), false);
    assert.ok(noteFiles.get(file.path).includes('[[Manual]]'));

    // Auto-generated section should be stripped.
    noteFiles.set(file.path, '# Note\n\n## 🏷️关联文件\n\n<!-- auto-links -->\n\n[[Auto]]\n\n<!-- /auto-links -->\n');
    assert.equal(await store.stripAutoRelatedSection(file), true);
    const after = noteFiles.get(file.path);
    assert.equal(after.includes('## 🏷️关联文件'), false);
    assert.equal(after.includes('[[Auto]]'), false);
    assert.ok(after.startsWith('# Note'));
});
