const MAX_ERROR_DETAIL_LENGTH = 400;
const MAX_LOG_STRING_LENGTH = 500;
const VALID_NETWORK_MODES = new Set(['local', 'embedding', 'full']);
const VALID_PROVIDERS = new Set(['none', 'openai', 'zhipu', 'custom']);

function safeNetworkMode(mode) {
    const value = String(mode || '').trim();
    return VALID_NETWORK_MODES.has(value) ? value : 'local';
}

function safeProvider(provider, fallback = 'none') {
    const value = String(provider || '').trim();
    if (VALID_PROVIDERS.has(value)) return value;
    return VALID_PROVIDERS.has(fallback) ? fallback : 'none';
}

function truncateText(text, maxLength = MAX_LOG_STRING_LENGTH) {
    const value = String(text || '');
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 14))}...[truncated]`;
}

function collectSecrets(source) {
    if (!source) return [];
    if (Array.isArray(source)) return source;
    const settings = source.settings && typeof source.settings === 'object' ? source.settings : source;
    return [
        settings.embeddingApiKey,
        settings.llmApiKey,
        settings.webhookUrl,
    ];
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactSensitiveText(text, source) {
    if (text === null || text === undefined) return '';
    let output = String(text);
    const secrets = collectSecrets(source)
        .map((secret) => String(secret || '').trim())
        .filter((secret) => secret.length >= 4);

    for (const secret of secrets) {
        const marker = secret.startsWith('http') ? '[REDACTED_WEBHOOK_URL]' : '[REDACTED_SECRET]';
        output = output.replace(new RegExp(escapeRegExp(secret), 'g'), marker);
    }

    output = output.replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;'"`]+/gi, '$1[REDACTED_AUTH]');
    output = output.replace(/\bbearer\s+[a-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED_TOKEN]');
    output = output.replace(/\bsk-[a-z0-9_-]{16,}/gi, '[REDACTED_SECRET]');
    output = output.replace(/([?&](?:api[_-]?key|key|token|password|secret)=)[^&#\s]+/gi, '$1[REDACTED_SECRET]');
    output = output.replace(/((?:api[_-]?key|key|token|password|secret)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;]+)/gi, '$1[REDACTED_SECRET]');
    output = output.replace(/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_TOKEN]');
    output = output.replace(/\b[A-Za-z0-9_/-]{40,}\b/g, '[REDACTED_SECRET]');

    return output;
}

function safeErrorDetail({ stdout = '', stderr = '', message = '', settings = null, includeStdout = false, maxLength = MAX_ERROR_DETAIL_LENGTH } = {}) {
    const parts = [];
    const redactedMessage = redactSensitiveText(message, settings).trim();
    const redactedStderr = redactSensitiveText(stderr, settings).trim();

    if (redactedMessage) parts.push(`message: ${redactedMessage}`);
    if (redactedStderr) parts.push(`stderr: ${redactedStderr}`);
    if (includeStdout && stdout) {
        parts.push(`stdout: ${redactSensitiveText(stdout, settings).trim()}`);
    } else if (stdout) {
        parts.push('stdout: [omitted]');
    }

    const detail = parts.join('\n') || 'No diagnostic detail available.';
    return truncateText(detail, maxLength);
}

function normalizeLogEntry(entry, settings) {
    const input = entry && typeof entry === 'object' ? entry : {};
    const normalized = { ...input };
    for (const [key, value] of Object.entries(normalized)) {
        if (typeof value === 'string') {
            normalized[key] = truncateText(redactSensitiveText(value, settings));
        } else if (Array.isArray(value)) {
            normalized[key] = value.map((item) => (
                typeof item === 'string' ? truncateText(redactSensitiveText(item, settings), 180) : item
            ));
        }
    }
    if (normalized.errorDetail) {
        normalized.errorDetail = truncateText(redactSensitiveText(normalized.errorDetail, settings), MAX_ERROR_DETAIL_LENGTH);
    }
    return normalized;
}

function normalizeSettings(data, defaults = {}, options = {}) {
    const settings = Object.assign({}, defaults, data || {});
    settings.networkMode = safeNetworkMode(settings.networkMode);
    settings.embeddingProvider = safeProvider(settings.embeddingProvider, defaults.embeddingProvider || 'none');
    settings.llmProvider = safeProvider(settings.llmProvider, defaults.llmProvider || 'none');

    if (settings.networkMode === 'local') {
        settings.webhookEnabled = false;
    } else {
        settings.webhookEnabled = !!settings.webhookEnabled;
    }

    if (options.resetRuntimeState !== false) {
        settings.lintInProgress = false;
        settings.refreshInProgress = false;
    }

    if (!Array.isArray(settings.refreshQueue)) settings.refreshQueue = [];
    if (!Number.isFinite(Number(settings.refreshQueueIndex))) settings.refreshQueueIndex = 0;
    if (!settings.notificationCooldown || typeof settings.notificationCooldown !== 'object') settings.notificationCooldown = {};
    if (!Array.isArray(settings.linkLog)) settings.linkLog = [];
    settings.linkLog = settings.linkLog.slice(0, options.maxLogEntries || 200)
        .map((entry) => normalizeLogEntry(entry, settings));

    return settings;
}

function canUseWebhook(settings) {
    return safeNetworkMode(settings && settings.networkMode) !== 'local'
        && !!(settings && settings.webhookEnabled)
        && !!String(settings && settings.webhookUrl || '').trim();
}

module.exports = {
    canUseWebhook,
    normalizeLogEntry,
    normalizeSettings,
    redactSensitiveText,
    safeErrorDetail,
    safeNetworkMode,
};
