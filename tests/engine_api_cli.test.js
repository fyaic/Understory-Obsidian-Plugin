const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT, 'understory-graphify-engine', 'api.py');
const ENGINE_DIR = path.dirname(API_PATH);

test('api.py init exits successfully in local-only mode', async (t) => {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-api-vault-'));
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });

    await fs.promises.mkdir(path.join(vaultPath, 'Notes'), { recursive: true });
    await fs.promises.writeFile(
        path.join(vaultPath, 'Notes', 'A.md'),
        '# A\n\nLocal keyword-only release smoke note.\n',
        'utf8'
    );

    const result = spawnSync(process.env.PYTHON || 'python', [API_PATH, 'init', '--vault', vaultPath], {
        cwd: ENGINE_DIR,
        encoding: 'utf8',
        env: {
            ...process.env,
            UNDERSTORY_NETWORK_MODE: 'local',
            PYTHONIOENCODING: 'utf-8',
        },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.network_mode, 'local');
    assert.equal(payload.indexing, 'skipped');
    assert.equal(payload.indexed_fail, 0);
});

test('api.py embedding-status reports local-only semantic mode', async (t) => {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-api-vault-'));
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });

    const result = spawnSync(process.env.PYTHON || 'python', [API_PATH, 'embedding-status', '--vault', vaultPath], {
        cwd: ENGINE_DIR,
        encoding: 'utf8',
        env: {
            ...process.env,
            UNDERSTORY_NETWORK_MODE: 'local',
            PYTHONIOENCODING: 'utf-8',
        },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.semantic_state, 'local_only');
    assert.equal(payload.indexing, 'skipped');
    assert.equal(payload.embedding_allowed, false);
    assert.equal(payload.recommended_action, 'configure_vector_model');
});

test('api.py embedding-status reports missing vector API key', async (t) => {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-api-vault-'));
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });

    const result = spawnSync(process.env.PYTHON || 'python', [API_PATH, 'embedding-status', '--vault', vaultPath], {
        cwd: ENGINE_DIR,
        encoding: 'utf8',
        env: {
            ...process.env,
            UNDERSTORY_NETWORK_MODE: 'embedding',
            UNDERSTORY_EMBEDDING_PROVIDER: 'openai',
            UNDERSTORY_EMBEDDING_API_KEY: '',
            OPENAI_API_KEY: '',
            ZHIPU_API_KEY: '',
            CUSTOM_OPENAI_API_KEY: '',
            PYTHONIOENCODING: 'utf-8',
        },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'warning');
    assert.equal(payload.semantic_state, 'provider_unavailable');
    assert.equal(payload.indexing, 'unavailable');
    assert.equal(payload.provider_ready, false);
    assert.equal(payload.recommended_action, 'configure_embedding_api');
});

test('api.py refresh-link falls back when embedding cache is missing', async (t) => {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-api-vault-'));
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });

    await fs.promises.mkdir(path.join(vaultPath, 'Notes'), { recursive: true });
    await fs.promises.mkdir(path.join(vaultPath, 'References'), { recursive: true });
    const suffix = path.basename(vaultPath).replace(/[^a-zA-Z0-9_-]/g, '');
    const source = path.join(vaultPath, 'Notes', `Source-${suffix}.md`);
    await fs.promises.writeFile(
        source,
        '# Source\n\nAlpha beta product planning connects roadmaps and team rituals.\n',
        'utf8'
    );
    await fs.promises.writeFile(
        path.join(vaultPath, 'References', `Target-${suffix}.md`),
        '# Target\n\nAlpha beta product planning notes for roadmap rituals.\n',
        'utf8'
    );

    const result = spawnSync(process.env.PYTHON || 'python', [
        API_PATH,
        'refresh-link',
        source,
        '--no-auto-write',
        '--vault',
        vaultPath,
    ], {
        cwd: ENGINE_DIR,
        encoding: 'utf8',
        env: {
            ...process.env,
            UNDERSTORY_NETWORK_MODE: 'full',
            UNDERSTORY_EMBEDDING_PROVIDER: 'mock',
            UNDERSTORY_LLM_PROVIDER: 'none',
            PYTHONIOENCODING: 'utf-8',
        },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.recall_mode, 'local-keyword-fallback');
    assert.ok(payload.relations_count >= 1);
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(payload.warnings.length >= 1);
    assert.equal(payload.fixes?.[0]?.id, 'embedding_index_missing');
    assert.match(payload.fixes?.[0]?.command || '', /api\.py" init --vault/);
});
