/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { installMockObsidian } = require('./helpers/mockObsidian');
installMockObsidian();

const runtime = require('../src/graphifyRuntime');

const fakeSecrets = {
    embeddingApiKey: 'sk-test-embedding-abcdefghijklmnopqrstuvwxyz',
    llmApiKey: 'sk-test-llm-abcdefghijklmnopqrstuvwxyz',
    webhookUrl: 'https://hooks.example.test/services/T000/B000/SECRET',
};

const managedProviderEnvKeys = [
    'UNDERSTORY_EMBEDDING_PROVIDER',
    'UNDERSTORY_EMBEDDING_BASE_URL',
    'UNDERSTORY_EMBEDDING_MODEL',
    'UNDERSTORY_EMBEDDING_DIMENSIONS',
    'UNDERSTORY_EMBEDDING_API_KEY',
    'UNDERSTORY_LLM_PROVIDER',
    'UNDERSTORY_LLM_BASE_URL',
    'UNDERSTORY_LLM_MODEL',
    'UNDERSTORY_LLM_API_KEY',
];

function createRuntimePlugin(settings = {}) {
    const plugin = Object.assign(Object.create(runtime), {
        app: {
            vault: {
                adapter: { getBasePath: () => 'C:/vault' },
                getAbstractFileByPath: () => null,
            },
            workspace: { getLeaf: () => ({ openFile: async () => {} }) },
        },
        settings: {
            graphifyDir: 'C:/engine',
            pythonPath: 'python',
            uiLanguage: 'en',
            linkLog: [],
            ...settings,
        },
        saveCount: 0,
        async saveSettings() {
            this.saveCount += 1;
        },
        _vaultBasePath() {
            return 'C:/vault';
        },
    });
    return plugin;
}

test('checkEmbeddingHealth stores semantic status from api.py', async () => {
    const plugin = createRuntimePlugin({ networkMode: 'embedding' });
    let receivedArgs = null;
    plugin.checkEngineHealth = async () => ({ ok: true });
    plugin._runEngineApi = async (args) => {
        receivedArgs = args;
        return {
            code: 0,
            stderr: '',
            payload: {
                status: 'warning',
                semantic_state: 'index_missing',
                indexing: 'missing',
                provider: 'mock',
                recommended_action: 'build_embedding_index',
            },
        };
    };

    const health = await plugin.checkEmbeddingHealth(false, true);

    assert.deepEqual(receivedArgs, ['embedding-status', '--vault', 'C:/vault']);
    assert.equal(health.status, 'warning');
    assert.equal(health.semantic_state, 'index_missing');
    assert.equal(plugin.embeddingHealth.recommended_action, 'build_embedding_index');
});

test('checkEmbeddingHealth treats local-only mode as ready without reading semantic index', async () => {
    const plugin = createRuntimePlugin({ networkMode: 'local', embeddingProvider: 'zhipu' });
    plugin.checkEngineHealth = async () => {
        throw new Error('should not check engine for local-only semantic status');
    };
    plugin._runEngineApi = async () => {
        throw new Error('should not run embedding status in local-only mode');
    };

    const health = await plugin.checkEmbeddingHealth(false, true);

    assert.equal(health.status, 'ok');
    assert.equal(health.semantic_state, 'local_only');
    assert.equal(health.indexing, 'skipped');
    assert.equal(plugin.embeddingHealth.recommended_action, 'configure_vector_model');
});

test('checkEmbeddingHealth keeps engine readiness separate from semantic readiness', async () => {
    const plugin = createRuntimePlugin({ networkMode: 'embedding' });
    plugin.checkEngineHealth = async () => ({ ok: false, message: 'engine missing' });
    plugin._runEngineApi = async () => {
        throw new Error('should not run embedding status when engine is missing');
    };

    const health = await plugin.checkEmbeddingHealth(false, true);

    assert.equal(health.status, 'error');
    assert.equal(health.semantic_state, 'engine_not_ready');
    assert.equal(health.recommended_action, 'check_engine_setup');
});

test('_showEngineGuidance refreshes semantic status for missing embedding index', () => {
    const plugin = createRuntimePlugin();
    let call = null;
    plugin.checkEmbeddingHealth = (showNotice, force) => {
        call = { showNotice, force };
        return Promise.resolve({ status: 'warning' });
    };

    plugin._showEngineGuidance({
        fixes: [{ id: 'embedding_index_missing' }],
        warnings: ['using keyword fallback'],
    });

    assert.deepEqual(call, { showNotice: false, force: true });
});

test('local mode strips managed provider and webhook env values', () => {
    const envKeys = [...managedProviderEnvKeys, 'UNDERSTORY_WEBHOOK_ENABLED'];
    const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of managedProviderEnvKeys) {
        process.env[key] = `ambient-${key.toLowerCase()}`;
    }
    process.env.UNDERSTORY_WEBHOOK_ENABLED = '1';

    try {
        const plugin = createRuntimePlugin({
            networkMode: 'local',
            uiLanguage: 'zh',
            webhookEnabled: true,
            ...fakeSecrets,
            embeddingProvider: 'zhipu',
            embeddingBaseUrl: 'https://embedding.example.test',
            embeddingModel: 'embedding-model',
            embeddingDimensions: 1024,
            llmProvider: 'zhipu',
            llmBaseUrl: 'https://llm.example.test',
            llmModel: 'llm-model',
        });
        const env = plugin._pythonEnv();

        assert.equal(env.UNDERSTORY_NETWORK_MODE, 'local');
        assert.equal(env.UNDERSTORY_UI_LANGUAGE, 'zh');
        assert.equal(env.UNDERSTORY_WEBHOOK_ENABLED, '0');
        for (const key of managedProviderEnvKeys) {
            assert.equal(Object.hasOwn(env, key), false, `${key} should not be passed in local mode`);
        }
    } finally {
        for (const key of envKeys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
});

test('embedding mode exposes only embedding provider settings', () => {
    const plugin = createRuntimePlugin({
        networkMode: 'embedding',
        webhookEnabled: true,
        ...fakeSecrets,
        embeddingProvider: 'zhipu',
        embeddingBaseUrl: 'https://embedding.example.test',
        embeddingModel: 'embedding-model',
        embeddingDimensions: 1024,
        llmProvider: 'zhipu',
        llmBaseUrl: 'https://llm.example.test',
        llmModel: 'llm-model',
    });
    const env = plugin._pythonEnv();

    assert.equal(env.UNDERSTORY_WEBHOOK_ENABLED, '1');
    assert.equal(env.UNDERSTORY_EMBEDDING_API_KEY, fakeSecrets.embeddingApiKey);
    assert.equal(env.UNDERSTORY_EMBEDDING_PROVIDER, 'zhipu');
    assert.equal(Object.hasOwn(env, 'UNDERSTORY_LLM_API_KEY'), false);
    assert.equal(Object.hasOwn(env, 'UNDERSTORY_LLM_PROVIDER'), false);
});

test('full mode exposes embedding and llm settings', () => {
    const plugin = createRuntimePlugin({
        networkMode: 'full',
        webhookEnabled: true,
        ...fakeSecrets,
        embeddingProvider: 'zhipu',
        llmProvider: 'zhipu',
    });
    const env = plugin._pythonEnv();

    assert.equal(env.UNDERSTORY_EMBEDDING_API_KEY, fakeSecrets.embeddingApiKey);
    assert.equal(env.UNDERSTORY_LLM_API_KEY, fakeSecrets.llmApiKey);
    assert.equal(env.UNDERSTORY_WEBHOOK_ENABLED, '1');
});

test('_addLogEntry redacts persisted details', async () => {
    const plugin = createRuntimePlugin({ ...fakeSecrets });

    await plugin._addLogEntry({
        status: 'error',
        message: `failed ${fakeSecrets.webhookUrl}`,
        errorDetail: `Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 ${fakeSecrets.llmApiKey}`,
        relations: [fakeSecrets.embeddingApiKey],
    });

    const serialized = JSON.stringify(plugin.settings.linkLog);
    assert.equal(serialized.includes(fakeSecrets.webhookUrl), false);
    assert.equal(serialized.includes(fakeSecrets.llmApiKey), false);
    assert.equal(serialized.includes(fakeSecrets.embeddingApiKey), false);
    assert.equal(plugin.saveCount, 1);
});

test('_parseAndLogResult parse errors omit raw stdout from persisted errorDetail', async () => {
    const plugin = createRuntimePlugin({ ...fakeSecrets });
    const originalError = console.error;
    console.error = () => {};
    try {
        await plugin._parseAndLogResult(
            { basename: 'Note', path: 'Note.md' },
            `not json vault body ${fakeSecrets.embeddingApiKey}`,
            `stderr ${fakeSecrets.llmApiKey}`
        );
    } finally {
        console.error = originalError;
    }

    const entry = plugin.settings.linkLog[0];
    assert.equal(entry.status, 'parse_error');
    assert.equal(entry.errorDetail.includes('vault body'), false);
    assert.equal(entry.errorDetail.includes(fakeSecrets.embeddingApiKey), false);
    assert.equal(entry.errorDetail.includes(fakeSecrets.llmApiKey), false);
    assert.match(entry.errorDetail, /stdout: \[omitted\]/);
});

test('checkEngineHealth returns a safe failure object instead of throwing', async () => {
    const plugin = createRuntimePlugin({
        graphifyDir: 'Z:/definitely/missing',
        pythonPath: 'python',
        ...fakeSecrets,
    });
    plugin._checkPythonVersion = async () => {
        throw new Error(`probe failed ${fakeSecrets.embeddingApiKey}`);
    };

    const result = await plugin.checkEngineHealth(false, true);

    assert.equal(result.ok, false);
    assert.ok(result.issues.length >= 2);
    assert.equal(JSON.stringify(result).includes(fakeSecrets.embeddingApiKey), false);
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
