/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('assert');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { RELATIONS_PATH } = require('../src/agentApi');

const CLI_PATH = path.join(__dirname, '..', 'scripts', 'understory-agent-cli.js');

function hash(content) {
    return crypto.createHash('sha256').update(String(content || '')).digest('hex').slice(0, 16);
}

async function createVault(t) {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-agent-cli-'));
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });
    return vaultPath;
}

async function createFakeEngine(t) {
    const enginePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-fake-engine-'));
    t.after(async () => {
        await fs.promises.rm(enginePath, { recursive: true, force: true });
    });
    await fs.promises.writeFile(path.join(enginePath, 'api.py'), [
        'import json, sys',
        'if "--vault" not in sys.argv or sys.argv.index("--vault") + 1 >= len(sys.argv) or not sys.argv[sys.argv.index("--vault") + 1]:',
        '    print("missing --vault", file=sys.stderr)',
        '    sys.exit(17)',
        'print(json.dumps({"status":"ok","relations":[{"title":"Target","path":"Notes/Target.md","score":0.88,"source":"fake-engine"}],"grouped":{"concept":["Target"]}}))',
        '',
    ].join('\n'), 'utf8');
    return enginePath;
}

async function createFailingFakeEngine(t, secret) {
    const enginePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-failing-engine-'));
    t.after(async () => {
        await fs.promises.rm(enginePath, { recursive: true, force: true });
    });
    await fs.promises.writeFile(path.join(enginePath, 'api.py'), [
        'import sys',
        `sys.stderr.write("engine failed ${secret}")`,
        'sys.exit(2)',
        '',
    ].join('\n'), 'utf8');
    return enginePath;
}

async function createSkippedFakeEngine(t) {
    const enginePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-skipped-engine-'));
    t.after(async () => {
        await fs.promises.rm(enginePath, { recursive: true, force: true });
    });
    await fs.promises.writeFile(path.join(enginePath, 'api.py'), [
        'import json, sys',
        'if "--vault" not in sys.argv:',
        '    print("missing --vault", file=sys.stderr)',
        '    sys.exit(17)',
        'print(json.dumps({"status":"skipped","reason":"unchanged","unchanged":True}))',
        '',
    ].join('\n'), 'utf8');
    return enginePath;
}

async function writeVaultFile(vaultPath, relativePath, content) {
    const absolute = path.join(vaultPath, ...relativePath.split('/'));
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, content, 'utf8');
}

async function readVaultJson(vaultPath, relativePath) {
    const raw = await fs.promises.readFile(path.join(vaultPath, ...relativePath.split('/')), 'utf8');
    return JSON.parse(raw);
}

async function seedRelations(vaultPath, notePath = 'Notes/Source.md') {
    const content = '# Source\n\nBody\n';
    await writeVaultFile(vaultPath, notePath, content);
    const stat = await fs.promises.stat(path.join(vaultPath, ...notePath.split('/')));
    await writeVaultFile(vaultPath, RELATIONS_PATH, JSON.stringify({
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
    }, null, 2));
}

function runCli(args) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        encoding: 'utf8',
    });
    const stdout = result.stdout.trim();
    assert.ok(stdout, 'CLI must write a JSON envelope to stdout');
    return {
        ...result,
        envelope: JSON.parse(stdout),
    };
}

test('CLI status and graph-summary return stable JSON envelopes', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath);
    await writeVaultFile(vaultPath, '.understory/conflicts.json', JSON.stringify({
        conflicts: [{ status: 'open', severity: 'high' }],
    }));
    await writeVaultFile(vaultPath, '.understory/index.md', '# Index\n');

    const status = runCli(['status', '--vault', vaultPath, '--json']);
    assert.equal(status.status, 0);
    assert.equal(status.envelope.ok, true);
    assert.equal(status.envelope.data.relationsStore.relationCount, 1);

    const graph = runCli(['graph-summary', '--vault', vaultPath, '--json']);
    assert.equal(graph.status, 0);
    assert.equal(graph.envelope.ok, true);
    assert.equal(graph.envelope.data.conflicts.openCount, 1);
    assert.equal(graph.envelope.data.conflicts.highCount, 1);
    assert.equal(graph.envelope.data.index.exists, true);
});

test('CLI capabilities and search return scoped Agent API data', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath);

    const capabilities = runCli(['capabilities', '--vault', vaultPath, '--json']);
    assert.equal(capabilities.status, 0);
    assert.equal(capabilities.envelope.ok, true);
    assert.ok(capabilities.envelope.data.tools.read.includes('understory_get_context'));

    const search = runCli(['search', '--vault', vaultPath, '--query', 'Target', '--json']);
    assert.equal(search.status, 0);
    assert.equal(search.envelope.ok, true);
    assert.equal(search.envelope.data.mode, 'local_keyword_relations');
    assert.ok(search.envelope.data.results.length >= 1);
    assert.equal(search.envelope.data.results[0].path, 'Notes/Source.md');
});

test('CLI get/accept/reject relation commands mutate the store', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath);

    const get = runCli(['get-relations', '--vault', vaultPath, '--note', 'Notes/Source.md', '--json']);
    assert.equal(get.status, 0);
    assert.equal(get.envelope.ok, true);
    assert.equal(get.envelope.data.relations[0].title, 'Target');

    const accept = runCli([
        'accept-relation',
        '--vault', vaultPath,
        '--note', 'Notes/Source.md',
        '--target', 'Target',
        '--json',
    ]);
    assert.equal(accept.status, 0);
    assert.equal(accept.envelope.data.status, 'accepted');

    const reject = runCli([
        'reject-relation',
        '--vault', vaultPath,
        '--note', 'Notes/Source.md',
        '--target', 'Notes/Target.md',
        '--json',
    ]);
    assert.equal(reject.status, 0);
    assert.equal(reject.envelope.data.status, 'rejected');

    const store = await readVaultJson(vaultPath, RELATIONS_PATH);
    assert.equal(store.files['Notes/Source.md'].relations[0].status, 'rejected');
    const overrides = await readVaultJson(vaultPath, '.understory/link_overrides.json');
    assert.equal(overrides['Notes/Source.md'].tombstones.Target.action, 'deleted');
});

test('CLI insert-relation and refresh-relations dry-run are callable', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath);

    const insert = runCli([
        'insert-relation',
        '--vault', vaultPath,
        '--note', 'Notes/Source.md',
        '--target', 'Notes/Target.md',
        '--title', 'Target',
        '--json',
    ]);
    assert.equal(insert.status, 0);
    assert.equal(insert.envelope.ok, true);
    assert.equal(insert.envelope.data.inserted, true);

    const refresh = runCli([
        'refresh-relations',
        '--vault', vaultPath,
        '--note', 'Notes/Source.md',
        '--dry-run',
        '--json',
    ]);
    assert.equal(refresh.status, 0);
    assert.equal(refresh.envelope.ok, true);
    assert.equal(refresh.envelope.data.dryRun, true);
});

test('CLI refresh-relations can use a local engine and update the relation cache', async (t) => {
    const vaultPath = await createVault(t);
    const enginePath = await createFakeEngine(t);
    await writeVaultFile(vaultPath, 'Notes/Source.md', '# Source\n\nBody\n');

    const refresh = runCli([
        'refresh-relations',
        '--vault', vaultPath,
        '--note', 'Notes/Source.md',
        '--engine-dir', enginePath,
        '--json',
    ]);
    assert.equal(refresh.status, 0);
    assert.equal(refresh.envelope.ok, true);
    assert.equal(refresh.envelope.data.relationsCount, 1);

    const store = await readVaultJson(vaultPath, RELATIONS_PATH);
    assert.equal(store.files['Notes/Source.md'].hash.length, 16);
    assert.equal(store.files['Notes/Source.md'].relations[0].source, 'fake-engine');
});

test('CLI refresh-relations treats skipped local engine results as successful no-ops', async (t) => {
    const vaultPath = await createVault(t);
    const enginePath = await createSkippedFakeEngine(t);
    await seedRelations(vaultPath);
    const seededStore = await readVaultJson(vaultPath, RELATIONS_PATH);
    seededStore.files['Notes/Source.md'].relations.push({
        target: '.obsidian/plugins/understory/understory-graphify-engine/SKILL.md',
        title: 'SKILL',
        type: 'semantic',
        score: 0.1,
        group: 'internal',
        status: 'suggested',
        source: 'old-cache',
    });
    await writeVaultFile(vaultPath, RELATIONS_PATH, JSON.stringify(seededStore));

    const refresh = runCli([
        'refresh-relations',
        '--vault', vaultPath,
        '--note', 'Notes/Source.md',
        '--engine-dir', enginePath,
        '--json',
    ]);
    assert.equal(refresh.status, 0);
    assert.equal(refresh.envelope.ok, true);
    assert.equal(refresh.envelope.data.status, 'skipped');
    assert.equal(refresh.envelope.data.relationsCount, 1);
    assert.equal(refresh.envelope.data.entry.relations[0].source, 'test');
    const store = await readVaultJson(vaultPath, RELATIONS_PATH);
    assert.equal(store.files['Notes/Source.md'].relations.length, 1);
    assert.equal(store.files['Notes/Source.md'].relations[0].target, 'Notes/Target.md');
});


test('CLI failures keep stdout JSON and non-zero exit codes', async (t) => {
    const vaultPath = await createVault(t);
    await writeVaultFile(vaultPath, 'Notes/Source.md', 'source note body');

    const missingArg = runCli(['get-relations', '--vault', vaultPath, '--json']);
    assert.notEqual(missingArg.status, 0);
    assert.equal(missingArg.envelope.ok, false);
    assert.equal(missingArg.envelope.error.code, 'INVALID_ARGUMENT');

    const missingNote = runCli([
        'get-relations',
        '--vault', vaultPath,
        '--note', 'Notes/Missing.md',
        '--json',
    ]);
    assert.notEqual(missingNote.status, 0);
    assert.equal(missingNote.envelope.error.code, 'NOTE_NOT_FOUND');

    const unsafe = runCli([
        'get-relations',
        '--vault', vaultPath,
        '--note', '../outside.md',
        '--json',
    ]);
    assert.notEqual(unsafe.status, 0);
    assert.equal(unsafe.envelope.error.code, 'UNSAFE_PATH');

    const missingTarget = runCli([
        'accept-relation',
        '--vault', vaultPath,
        '--note', 'Notes/Source.md',
        '--json',
    ]);
    assert.notEqual(missingTarget.status, 0);
    assert.equal(missingTarget.envelope.error.code, 'INVALID_ARGUMENT');
});

test('CLI redacts fake secrets from engine diagnostics', async (t) => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const vaultPath = await createVault(t);
    const enginePath = await createFailingFakeEngine(t, secret);
    await writeVaultFile(vaultPath, 'Notes/Source.md', 'source note body');
    const result = spawnSync(process.execPath, [
        CLI_PATH,
        'refresh-relations',
        '--vault',
        vaultPath,
        '--note',
        'Notes/Source.md',
        '--engine-dir',
        enginePath,
        '--json',
    ], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
    const envelope = JSON.parse(result.stdout.trim());
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'ENGINE_FAILED');
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
