/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
    canUseWebhook,
    extractProcessJsonMessage,
    normalizeLogEntry,
    normalizeSettings,
    redactSensitiveText,
    safeErrorDetail,
} = require('../src/safety');

const settings = {
    embeddingApiKey: 'sk-test-abcdefghijklmnopqrstuvwxyz123456',
    llmApiKey: 'llm-secret-token-abcdefghijklmnopqrstuvwxyz',
    webhookUrl: 'https://hooks.example.test/services/T000/B000/SECRET',
};

test('redactSensitiveText removes explicit secrets, bearer tokens, and webhook URLs', () => {
    const input = [
        `embedding=${settings.embeddingApiKey}`,
        `llm=${settings.llmApiKey}`,
        `webhook=${settings.webhookUrl}`,
        'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
        'url=https://api.example.test?api_key=abcdefghijklmnopqrstuvwxyz123456',
    ].join('\n');

    const output = redactSensitiveText(input, settings);

    assert.equal(output.includes(settings.embeddingApiKey), false);
    assert.equal(output.includes(settings.llmApiKey), false);
    assert.equal(output.includes(settings.webhookUrl), false);
    assert.match(output, /\[REDACTED_SECRET\]/);
    assert.match(output, /\[REDACTED_WEBHOOK_URL\]/);
    assert.match(output, /\[REDACTED_AUTH\]/);
});

test('redactSensitiveText removes environment dump style secrets', () => {
    const input = [
        'UNDERSTORY_EMBEDDING_API_KEY=abcdefghijklmnopqrstuvwxyz123456',
        'OPENAI_API_KEY="sk-env-abcdefghijklmnopqrstuvwxyz"',
        'password: plain-text-password',
        'token=plain-text-token',
    ].join('\n');

    const output = redactSensitiveText(input, settings);

    assert.equal(output.includes('abcdefghijklmnopqrstuvwxyz123456'), false);
    assert.equal(output.includes('sk-env-abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(output.includes('plain-text-password'), false);
    assert.equal(output.includes('plain-text-token'), false);
    assert.match(output, /\[REDACTED_SECRET\]/);
});

test('safeErrorDetail omits stdout by default and truncates diagnostics', () => {
    const detail = safeErrorDetail({
        stdout: `vault body ${'x'.repeat(700)}`,
        stderr: `failed with ${settings.embeddingApiKey}`,
        settings,
    });

    assert.equal(detail.includes('vault body'), false);
    assert.equal(detail.includes(settings.embeddingApiKey), false);
    assert.match(detail, /stdout: \[omitted\]/);
    assert.ok(detail.length <= 400);
});

test('extractProcessJsonMessage reads engine JSON errors from stdout', () => {
    const stdout = [
        'debug line',
        '{"status":"error","message":"missing embedding cache","error_detail":"run init first"}',
    ].join('\n');

    assert.equal(
        extractProcessJsonMessage(stdout),
        'missing embedding cache run init first'
    );
});

test('normalizeLogEntry redacts string fields before persistence', () => {
    const entry = normalizeLogEntry({
        status: 'error',
        message: `sent ${settings.webhookUrl}`,
        errorDetail: `token=${settings.llmApiKey}`,
        relations: [`${settings.embeddingApiKey}.md`],
    }, settings);

    assert.equal(JSON.stringify(entry).includes(settings.webhookUrl), false);
    assert.equal(JSON.stringify(entry).includes(settings.llmApiKey), false);
    assert.equal(JSON.stringify(entry).includes(settings.embeddingApiKey), false);
});

test('normalizeSettings migrates unsafe persisted settings to safe defaults', () => {
    const normalized = normalizeSettings({
        networkMode: 'surprise',
        webhookEnabled: true,
        lintInProgress: true,
        refreshInProgress: true,
        linkLog: [{ errorDetail: `secret ${settings.embeddingApiKey}` }],
        embeddingProvider: 'unknown',
        llmProvider: 'unknown',
    }, {
        networkMode: 'local',
        embeddingProvider: 'zhipu',
        llmProvider: 'zhipu',
        notificationCooldown: {},
    });

    assert.equal(normalized.networkMode, 'local');
    assert.equal(normalized.webhookEnabled, false);
    assert.equal(normalized.lintInProgress, false);
    assert.equal(normalized.refreshInProgress, false);
    assert.equal(normalized.embeddingProvider, 'zhipu');
    assert.equal(normalized.llmProvider, 'zhipu');
    assert.equal(JSON.stringify(normalized.linkLog).includes(settings.embeddingApiKey), false);
});

test('normalizeSettings keeps Kimi reasoning providers', () => {
    const normalized = normalizeSettings({
        embeddingProvider: 'openai',
        llmProvider: 'kimi-global',
    }, {
        networkMode: 'full',
        embeddingProvider: 'zhipu',
        llmProvider: 'zhipu',
    });

    assert.equal(normalized.embeddingProvider, 'openai');
    assert.equal(normalized.llmProvider, 'kimi-global');
});

test('canUseWebhook requires non-local mode, enabled flag, and URL', () => {
    assert.equal(canUseWebhook({ networkMode: 'local', webhookEnabled: true, webhookUrl: settings.webhookUrl }), false);
    assert.equal(canUseWebhook({ networkMode: 'embedding', webhookEnabled: false, webhookUrl: settings.webhookUrl }), false);
    assert.equal(canUseWebhook({ networkMode: 'embedding', webhookEnabled: true, webhookUrl: '' }), false);
    assert.equal(canUseWebhook({ networkMode: 'embedding', webhookEnabled: true, webhookUrl: settings.webhookUrl }), true);
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- End CommonJS audit bridge. */
