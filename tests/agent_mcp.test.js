const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { RELATIONS_PATH } = require('../src/agentApi');

const MCP_PATH = path.join(__dirname, '..', 'scripts', 'understory-mcp-server.js');

function hash(content) {
    return crypto.createHash('sha256').update(String(content || '')).digest('hex').slice(0, 16);
}

async function createVault(t) {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-agent-mcp-'));
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

async function writeVaultFile(vaultPath, relativePath, content) {
    const absolute = path.join(vaultPath, ...relativePath.split('/'));
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, content, 'utf8');
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

function startMcp(t, args) {
    const child = spawn(process.execPath, [MCP_PATH, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let nextId = 1;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const pending = new Map();

    child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString('utf8');
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim()) continue;
            const message = JSON.parse(line);
            if (pending.has(message.id)) {
                pending.get(message.id)(message);
                pending.delete(message.id);
            }
        }
    });
    child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf8');
    });
    t.after(() => {
        child.kill();
    });

    function request(method, params = {}) {
        const id = nextId;
        nextId += 1;
        const message = { jsonrpc: '2.0', id, method, params };
        const wait = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timed out waiting for MCP response ${id}. stderr=${stderrBuffer}`));
            }, 5000);
            pending.set(id, (response) => {
                clearTimeout(timeout);
                resolve(response);
            });
        });
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return wait;
    }

    function notify(method, params = {}) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    }

    return {
        child,
        notify,
        request,
        get stderr() {
            return stderrBuffer;
        },
    };
}

test('MCP server initializes, lists tools, and calls read tools', async (t) => {
    const vaultPath = await createVault(t);
    await seedRelations(vaultPath);
    const client = startMcp(t, ['--vault', vaultPath]);

    const initialized = await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    assert.equal(initialized.result.capabilities.tools.constructor, Object);
    client.notify('notifications/initialized');

    const listed = await client.request('tools/list');
    const names = listed.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('understory_status'));
    assert.ok(names.includes('understory_get_capabilities'));
    assert.ok(names.includes('understory_get_relations'));
    assert.ok(names.includes('understory_search'));
    assert.ok(names.includes('understory_get_context'));
    assert.ok(names.includes('understory_get_note_brief'));
    assert.ok(names.includes('understory_insert_relation'));
    assert.ok(listed.result.tools.find((tool) => tool.name === 'understory_insert_relation').description.includes('Modifies local vault'));

    const status = await client.request('tools/call', {
        name: 'understory_status',
        arguments: {},
    });
    assert.equal(status.result.isError, false);
    assert.equal(status.result.structuredContent.ok, true);
    assert.equal(status.result.structuredContent.data.relationsStore.relationCount, 1);

    const relations = await client.request('tools/call', {
        name: 'understory_get_relations',
        arguments: { notePath: 'Notes/Source.md' },
    });
    assert.equal(relations.result.isError, false);
    assert.equal(relations.result.structuredContent.data.relations[0].title, 'Target');
    assert.deepEqual(JSON.parse(relations.result.content[0].text), relations.result.structuredContent);

    const capabilities = await client.request('tools/call', {
        name: 'understory_get_capabilities',
        arguments: {},
    });
    assert.equal(capabilities.result.isError, false);
    assert.equal(capabilities.result.structuredContent.data.privacy.opensHttpPort, false);

    const search = await client.request('tools/call', {
        name: 'understory_search',
        arguments: { query: 'target' },
    });
    assert.equal(search.result.isError, false);
    assert.ok(search.result.structuredContent.data.results.length >= 1);
    assert.equal(search.result.structuredContent.data.results[0].path, 'Notes/Source.md');
    assert.ok(search.result.structuredContent.data.results[0].snippet);
});

test('MCP tool errors stay structured and redact fake secrets', async (t) => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const vaultPath = await createVault(t);
    const enginePath = await createFailingFakeEngine(t, secret);
    await writeVaultFile(vaultPath, 'Notes/Source.md', 'source note body');
    const client = startMcp(t, ['--vault', vaultPath, '--engine-dir', enginePath]);

    await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    const result = await client.request('tools/call', {
        name: 'understory_refresh_relations',
        arguments: { notePath: 'Notes/Source.md' },
    });
    const serialized = JSON.stringify(result);
    assert.equal(result.result.isError, true);
    assert.equal(result.result.structuredContent.error.code, 'ENGINE_FAILED');
    assert.equal(serialized.includes(secret), false);
    assert.equal(client.stderr.includes(secret), false);
});

test('MCP call rejects unsafe note paths as tool-level errors', async (t) => {
    const vaultPath = await createVault(t);
    await writeVaultFile(vaultPath, 'Notes/Source.md', 'source note body');
    const client = startMcp(t, ['--vault', vaultPath]);

    await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    const result = await client.request('tools/call', {
        name: 'understory_get_relations',
        arguments: { notePath: '../outside.md' },
    });
    assert.equal(result.result.isError, true);
    assert.equal(result.result.structuredContent.error.code, 'UNSAFE_PATH');
});

test('MCP refresh tool can use a local engine and update the relation cache', async (t) => {
    const vaultPath = await createVault(t);
    const enginePath = await createFakeEngine(t);
    await writeVaultFile(vaultPath, 'Notes/Source.md', '# Source\n\nBody\n');
    const client = startMcp(t, ['--vault', vaultPath, '--engine-dir', enginePath]);

    await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    const result = await client.request('tools/call', {
        name: 'understory_refresh_relations',
        arguments: { notePath: 'Notes/Source.md' },
    });
    assert.equal(result.result.isError, false);
    assert.equal(result.result.structuredContent.ok, true);
    assert.equal(result.result.structuredContent.data.relationsCount, 1);

    const raw = await fs.promises.readFile(path.join(vaultPath, '.understory', 'relations.json'), 'utf8');
    const store = JSON.parse(raw);
    assert.equal(store.files['Notes/Source.md'].hash.length, 16);
    assert.equal(store.files['Notes/Source.md'].relations[0].source, 'fake-engine');
});
