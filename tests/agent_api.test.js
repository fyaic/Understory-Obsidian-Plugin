const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
    OVERRIDES_PATH,
    RELATIONS_PATH,
    createAgentApi,
} = require('../src/agentApi');

function hash(content) {
    return crypto.createHash('sha256').update(String(content || '')).digest('hex').slice(0, 16);
}

async function createVault(t) {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-agent-api-'));
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });
    return vaultPath;
}

async function writeVaultFile(vaultPath, relativePath, content) {
    const absolute = path.join(vaultPath, ...relativePath.split('/'));
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, content, 'utf8');
    return absolute;
}

async function readVaultJson(vaultPath, relativePath) {
    const raw = await fs.promises.readFile(path.join(vaultPath, ...relativePath.split('/')), 'utf8');
    return JSON.parse(raw);
}

async function seedRelations(vaultPath, notePath, content = 'source note body') {
    await writeVaultFile(vaultPath, notePath, content);
    const stat = await fs.promises.stat(path.join(vaultPath, ...notePath.split('/')));
    const store = {
        version: 1,
        indexedAt: '2026-06-18T03:00:00.000Z',
        files: {
            [notePath]: {
                hash: hash(content),
                mtime: stat.mtimeMs,
                indexedAt: '2026-06-18T03:00:00.000Z',
                relations: [{
                    target: 'Notes/Target.md',
                    title: 'Target',
                    type: 'semantic',
                    score: 0.91,
                    group: 'concept',
                    status: 'suggested',
                    source: 'test',
                    createdAt: '2026-06-18T03:00:00.000Z',
                    updatedAt: '2026-06-18T03:00:00.000Z',
                }],
            },
        },
    };
    await writeVaultFile(vaultPath, RELATIONS_PATH, JSON.stringify(store, null, 2));
    return store;
}

test('status and getRelations work in an empty fs vault without Obsidian', async (t) => {
    const vaultPath = await createVault(t);
    await writeVaultFile(vaultPath, 'Notes/Source.md', 'source note body');
    const api = createAgentApi({ vaultPath });

    const status = await api.status();
    assert.equal(status.ok, true);
    assert.equal(status.data.relationsStore.exists, false);
    assert.equal(status.data.relationsStore.relationCount, 0);

    const relations = await api.getRelations({ notePath: 'Notes/Source.md' });
    assert.equal(relations.ok, true);
    assert.equal(relations.data.status, 'missing');
    assert.equal(relations.data.stale, true);
    assert.deepEqual(relations.data.relations, []);
});

test('status preserves normal vault paths in data and metadata', async (t) => {
    const vaultPath = await createVault(t);
    const api = createAgentApi({ vaultPath });
    const status = await api.status();
    const normalized = vaultPath.replace(/\\/g, '/');

    assert.equal(status.ok, true);
    assert.equal(status.data.vaultPath, normalized);
    assert.equal(status.meta.vaultPath, normalized);
});

test('getRelations returns stored relations and detects stale notes', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath, 'Notes/Source.md');
    const api = createAgentApi({ vaultPath });

    const current = await api.getRelations({ notePath: 'Notes/Source.md' });
    assert.equal(current.ok, true);
    assert.equal(current.data.status, 'ok');
    assert.equal(current.data.stale, false);
    assert.equal(current.data.relations[0].title, 'Target');

    await writeVaultFile(vaultPath, 'Notes/Source.md', 'changed source note body');
    const stale = await api.getRelations({ notePath: 'Notes/Source.md' });
    assert.equal(stale.ok, true);
    assert.equal(stale.data.stale, true);
});

test('getRelations treats RelationsStore-style 16 character hashes as fresh', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath, 'Notes/Source.md', 'source note body');
    const store = await readVaultJson(vaultPath, RELATIONS_PATH);
    assert.equal(store.files['Notes/Source.md'].hash.length, 16);

    const api = createAgentApi({ vaultPath });
    const current = await api.getRelations({ notePath: 'Notes/Source.md' });
    assert.equal(current.ok, true);
    assert.equal(current.data.status, 'ok');
    assert.equal(current.data.stale, false);
});

test('Vault-as-API read tools return scoped snippets and relation context', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath, 'Notes/Source.md', '# Source\n\nMemory architecture connects local notes without scanning every file.');
    await writeVaultFile(vaultPath, 'Notes/Target.md', '# Target\n\nTarget note explains the memory graph and local API boundaries.');
    const api = createAgentApi({ vaultPath });

    const capabilities = await api.getCapabilities();
    assert.equal(capabilities.ok, true);
    assert.equal(capabilities.data.privacy.opensHttpPort, false);
    assert.ok(capabilities.data.tools.read.includes('understory_search'));

    const search = await api.search({ query: 'memory graph', limit: 5 });
    assert.equal(search.ok, true);
    assert.equal(search.data.mode, 'local_keyword_relations');
    assert.ok(search.data.results.length >= 1);
    assert.ok(search.data.results[0].snippet.length < 260);
    assert.ok(search.data.results[0].why);

    const brief = await api.getNoteBrief({ notePath: 'Notes/Source.md' });
    assert.equal(brief.ok, true);
    assert.equal(brief.data.bodyIncluded, false);
    assert.equal(brief.data.relationCount, 1);
    assert.equal(brief.data.relations[0].target, 'Notes/Target.md');

    const context = await api.getContext({ notePath: 'Notes/Source.md', limit: 3 });
    assert.equal(context.ok, true);
    assert.equal(context.data.bodyIncluded, false);
    assert.equal(context.data.mode, 'note_relations_context');
    assert.ok(context.data.items.some((item) => item.path === 'Notes/Target.md'));
});

test('relation target drift is annotated, resolved in context, and kept read-only', async (t) => {
    const vaultPath = await createVault(t);
    const sourcePath = 'Notes/Source.md';
    const movedPath = 'AIC-会议纪要/0605-周会：知识库自维护插件-试用客户跟进-AuthO进度.md';
    const oldPath = '录音/会议纪要/0605-周会：知识库自维护插件-试用客户跟进-AuthO进度.md';
    const sourceContent = '# Source\n\nThis source references the AuthO progress meeting.';
    await writeVaultFile(vaultPath, sourcePath, sourceContent);
    await writeVaultFile(vaultPath, movedPath, '# AuthO Progress\n\nMoved meeting note content that should be available through resolvedTarget.');
    await writeVaultFile(vaultPath, 'Archive/Duplicate.md', '# Duplicate\n\nFirst candidate.');
    await writeVaultFile(vaultPath, 'Moved/Duplicate.md', '# Duplicate\n\nSecond candidate.');
    const stat = await fs.promises.stat(path.join(vaultPath, ...sourcePath.split('/')));
    const store = {
        version: 1,
        indexedAt: '2026-06-18T03:00:00.000Z',
        files: {
            [sourcePath]: {
                hash: hash(sourceContent),
                mtime: stat.mtimeMs,
                indexedAt: '2026-06-18T03:00:00.000Z',
                relations: [{
                    target: oldPath,
                    title: '0605-周会：知识库自维护插件-试用客户跟进-AuthO进度',
                    type: 'semantic',
                    score: 0.91,
                    group: 'meeting',
                    status: 'suggested',
                    source: 'test',
                }, {
                    target: 'Missing/Gone.md',
                    title: 'Gone',
                    type: 'semantic',
                    status: 'suggested',
                    source: 'test',
                }, {
                    target: 'Old/Duplicate.md',
                    title: 'Duplicate',
                    type: 'semantic',
                    status: 'suggested',
                    source: 'test',
                }, {
                    target: '../outside.md',
                    title: 'Unsafe',
                    type: 'semantic',
                    status: 'suggested',
                    source: 'test',
                }],
            },
        },
    };
    await writeVaultFile(vaultPath, RELATIONS_PATH, JSON.stringify(store, null, 2));
    const before = await fs.promises.readFile(path.join(vaultPath, ...RELATIONS_PATH.split('/')), 'utf8');

    const api = createAgentApi({ vaultPath });
    const relations = await api.getRelations({ notePath: sourcePath });
    assert.equal(relations.ok, true);
    const resolved = relations.data.relations.find((relation) => relation.target === oldPath);
    assert.equal(resolved.targetStatus, 'resolved');
    assert.equal(resolved.targetExists, false);
    assert.equal(resolved.resolvedTarget, movedPath);
    assert.equal(resolved.resolutionReason, 'unique_basename');
    assert.equal(
        relations.data.entry.relations.find((relation) => relation.target === oldPath).targetStatus,
        'resolved'
    );
    assert.equal(
        relations.data.entry.relations.find((relation) => relation.target === oldPath).resolvedTarget,
        movedPath
    );
    assert.equal(relations.data.relations.find((relation) => relation.target === 'Missing/Gone.md').targetStatus, 'missing');
    const ambiguous = relations.data.relations.find((relation) => relation.target === 'Old/Duplicate.md');
    assert.equal(ambiguous.targetStatus, 'ambiguous');
    assert.deepEqual(ambiguous.candidates.sort(), ['Archive/Duplicate.md', 'Moved/Duplicate.md']);
    assert.equal(relations.data.relations.find((relation) => relation.target === '../outside.md').targetStatus, 'unsafe');
    assert.equal(relations.data.diagnostics.relationTargets.resolved, 1);
    assert.equal(relations.data.diagnostics.relationTargets.missing, 1);
    assert.equal(relations.data.diagnostics.relationTargets.ambiguous, 1);
    assert.equal(relations.data.diagnostics.relationTargets.unsafe, 1);

    const search = await api.search({ query: 'AuthO', limit: 5 });
    assert.equal(search.ok, true);
    const searchResult = search.data.results.find((result) => (
        result.matchedRelations || []
    ).some((relation) => relation.target === oldPath));
    assert.ok(searchResult);
    const searchRelation = searchResult.matchedRelations.find((relation) => relation.target === oldPath);
    assert.equal(searchRelation.targetStatus, 'resolved');
    assert.equal(searchRelation.resolvedTarget, movedPath);

    const context = await api.getContext({ notePath: sourcePath, limit: 5 });
    assert.equal(context.ok, true);
    assert.equal(context.data.bodyIncluded, false);
    assert.ok(context.data.items.some((item) => item.path === movedPath));
    assert.ok(!context.data.items.some((item) => item.path === oldPath));
    assert.ok(context.data.diagnostics.resolvedRelations.some((relation) => relation.resolvedTarget === movedPath));
    assert.ok(context.data.diagnostics.unresolvedRelations.some((relation) => relation.targetStatus === 'missing'));
    assert.ok(context.data.diagnostics.unresolvedRelations.some((relation) => relation.targetStatus === 'ambiguous'));
    assert.ok(context.data.diagnostics.unresolvedRelations.some((relation) => relation.targetStatus === 'unsafe'));

    const after = await fs.promises.readFile(path.join(vaultPath, ...RELATIONS_PATH.split('/')), 'utf8');
    assert.equal(after, before);
});

test('acceptRelation and rejectRelation update relation state and tombstones', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath, 'Notes/Source.md');
    const api = createAgentApi({ vaultPath });

    const accepted = await api.acceptRelation({ notePath: 'Notes/Source.md', target: 'Target' });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.data.status, 'accepted');

    let store = await readVaultJson(vaultPath, RELATIONS_PATH);
    assert.equal(store.files['Notes/Source.md'].relations[0].status, 'accepted');

    const rejected = await api.rejectRelation({ notePath: 'Notes/Source.md', target: 'Notes/Target.md' });
    assert.equal(rejected.ok, true);
    assert.equal(rejected.data.status, 'rejected');
    assert.equal(rejected.data.tombstone, true);

    store = await readVaultJson(vaultPath, RELATIONS_PATH);
    assert.equal(store.files['Notes/Source.md'].relations[0].status, 'rejected');
    const overrides = await readVaultJson(vaultPath, OVERRIDES_PATH);
    assert.equal(overrides['Notes/Source.md'].tombstones.Target.action, 'deleted');
});

test('insertRelation writes a link, reports section details, and avoids duplicate inserts', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath, 'Notes/Source.md', '# Source\n\nBody\n');
    const api = createAgentApi({ vaultPath });

    const inserted = await api.insertRelation({
        notePath: 'Notes/Source.md',
        target: 'Notes/Target.md',
        title: 'Target',
    });
    assert.equal(inserted.ok, true);
    assert.equal(inserted.data.inserted, true);
    assert.equal(inserted.data.alreadyExists, false);
    assert.equal(inserted.data.sectionHeading, '## Related notes');
    assert.equal(inserted.data.relationUpdated, true);

    const note = await fs.promises.readFile(path.join(vaultPath, 'Notes', 'Source.md'), 'utf8');
    assert.match(note, /\[\[Target\]\]/);
    const store = await readVaultJson(vaultPath, RELATIONS_PATH);
    assert.equal(store.files['Notes/Source.md'].relations[0].status, 'accepted');

    const duplicate = await api.insertRelation({
        notePath: 'Notes/Source.md',
        target: 'Notes/Target.md',
        title: 'Target',
    });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.data.inserted, false);
    assert.equal(duplicate.data.alreadyExists, true);
});

test('unsafe note and target paths are rejected', async (t) => {
    const vaultPath = await createVault(t);
    await writeVaultFile(vaultPath, 'Notes/Source.md', 'source note body');
    const api = createAgentApi({ vaultPath });

    const noteResult = await api.getRelations({ notePath: '../outside.md' });
    assert.equal(noteResult.ok, false);
    assert.equal(noteResult.error.code, 'UNSAFE_PATH');

    const targetResult = await api.insertRelation({
        notePath: 'Notes/Source.md',
        target: '../outside.md',
    });
    assert.equal(targetResult.ok, false);
    assert.equal(targetResult.error.code, 'UNSAFE_PATH');
});

test('error envelopes redact fake secrets from diagnostics', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const api = createAgentApi({
        vaultPath: path.join(os.tmpdir(), `missing-${secret}`),
        settings: { embeddingApiKey: secret },
    });

    const result = await api.status();
    const serialized = JSON.stringify(result);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'VAULT_NOT_FOUND');
    assert.equal(serialized.includes(secret), false);
});
