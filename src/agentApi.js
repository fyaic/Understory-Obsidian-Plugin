const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
    redactSensitiveText,
    extractProcessJsonMessage,
    safeErrorDetail,
    safeNetworkMode,
} = require('./safety');

const API_VERSION = '1';
const RELATIONS_PATH = '.understory/relations.json';
const OVERRIDES_PATH = '.understory/link_overrides.json';
const CONFLICTS_PATH = '.understory/conflicts.json';
const INDEX_PATH = '.understory/index.md';

const ERROR_MESSAGES = {
    VAULT_NOT_FOUND: 'Vault path was not found.',
    UNSAFE_PATH: 'Path must stay inside the vault.',
    NOTE_NOT_FOUND: 'Note was not found in vault.',
    RELATION_NOT_FOUND: 'Relation was not found.',
    STORE_NOT_FOUND: 'Relations store was not found.',
    ENGINE_NOT_READY: 'Understory engine is not ready.',
    ENGINE_FAILED: 'Understory engine failed.',
    PARSE_FAILED: 'Could not parse Understory data.',
    INVALID_ARGUMENT: 'Required argument is missing or invalid.',
    INTERNAL_ERROR: 'Internal Agent API error.',
};

class AgentApiError extends Error {
    constructor(code, message, detail) {
        super(message || ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR);
        this.name = 'AgentApiError';
        this.code = ERROR_MESSAGES[code] ? code : 'INTERNAL_ERROR';
        this.detail = detail || '';
    }
}

function toPosixPath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasPathTraversal(relativePath) {
    return relativePath === '..' || relativePath.startsWith('../') || relativePath.includes('/../');
}

function isInsidePath(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeVaultRoot(vaultPath) {
    if (!vaultPath) return '';
    return path.resolve(String(vaultPath));
}

function hashContent(content) {
    return crypto.createHash('sha256').update(String(content || '')).digest('hex').slice(0, 16);
}

function configuredSecrets(settings) {
    if (!settings || typeof settings !== 'object') return [];
    return [
        settings.embeddingApiKey,
        settings.llmApiKey,
        settings.apiKey,
        settings.webhookUrl,
        settings.customEndpoint,
    ].map((value) => String(value || '').trim()).filter((value) => value.length >= 4);
}

function redactConfiguredSecrets(text, settings) {
    let output = String(text || '');
    for (const secret of configuredSecrets(settings)) {
        output = output.split(secret).join(secret.startsWith('http') ? '[REDACTED_WEBHOOK_URL]' : '[REDACTED_SECRET]');
    }
    return output;
}

function countLinesBefore(content, index) {
    if (index <= 0) return 1;
    return String(content).slice(0, index).split(/\r?\n/).length;
}

function clampLimit(value, fallback = 8, max = 25) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.min(Math.floor(number), max);
}

function searchTerms(query) {
    return String(query || '')
        .toLowerCase()
        .split(/[\s,，。.;；:：!?！？()[\]{}"'`]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
        .slice(0, 8);
}

function stripMarkdownNoise(content) {
    return String(content || '')
        .replace(/^---[\s\S]*?---\s*/m, '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#>*_`~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function compactSnippet(content, query, maxLength = 220) {
    const clean = stripMarkdownNoise(content);
    if (!clean) return '';
    const lower = clean.toLowerCase();
    const terms = searchTerms(query);
    const firstHit = terms
        .map((term) => lower.indexOf(term))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
    const start = firstHit > 60 ? firstHit - 60 : 0;
    const snippet = clean.slice(start, start + maxLength);
    return `${start > 0 ? '...' : ''}${snippet}${start + maxLength < clean.length ? '...' : ''}`;
}

function noteTitleFromPath(notePath) {
    return titleFromTarget(notePath);
}

function relationText(relation) {
    if (!relation) return '';
    return [
        relation.title,
        relation.target,
        relation.type,
        relation.group,
        relation.source,
    ].filter(Boolean).join(' ');
}

function createMeta(context, settings) {
    const meta = {
        apiVersion: API_VERSION,
        timestamp: new Date().toISOString(),
    };
    const vaultPath = context && context.getVaultPath && context.getVaultPath();
    if (vaultPath) meta.vaultPath = redactConfiguredSecrets(toPosixPath(vaultPath), settings);
    return meta;
}

function ok(data, context, settings) {
    return {
        ok: true,
        data,
        error: null,
        meta: createMeta(context, settings),
    };
}

function errorEnvelope(error, context, settings) {
    const apiError = error instanceof AgentApiError
        ? error
        : new AgentApiError('INTERNAL_ERROR', ERROR_MESSAGES.INTERNAL_ERROR, safeErrorDetail({
            message: error && error.message ? error.message : String(error || ''),
            settings,
        }));

    const detail = redactSensitiveText(apiError.detail || '', settings);
    return {
        ok: false,
        data: null,
        error: {
            code: apiError.code,
            message: apiError.message,
            detail,
        },
        meta: createMeta(context, settings),
    };
}

function cleanLinkTitle(value) {
    return String(value || '')
        .replace(/\[\[/g, '')
        .replace(/\]\]/g, '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
}

function titleFromTarget(target) {
    const normalized = toPosixPath(target);
    const base = normalized.split('/').filter(Boolean).pop() || normalized;
    return cleanLinkTitle(base.replace(/\.md$/i, ''));
}

function relationSectionHeadings() {
    return [
        '## Related notes',
        '## Related Notes',
        '## Manually related notes',
        '## Related',
        '## 关联文件',
        '## 相关笔记',
        '## 🏷️ Related notes',
        '## 🏷️关联文件',
    ];
}

function findRelationSection(content) {
    let best = null;
    for (const heading of relationSectionHeadings()) {
        const index = content.indexOf(heading);
        if (index !== -1 && (!best || index < best.index)) {
            best = { index, heading };
        }
    }
    return best;
}

function insertLinkIntoContent(content, link) {
    if (content.includes(link)) {
        return {
            content,
            inserted: false,
            alreadyExists: true,
            sectionHeading: null,
            line: null,
        };
    }

    const section = findRelationSection(content);
    let nextContent;
    let insertIndex;
    let sectionHeading;

    if (!section) {
        const trimmed = content.replace(/\s+$/, '');
        const prefix = `${trimmed}\n\n## Related notes\n\n### Manually added\n\n`;
        nextContent = `${prefix}${link}\n`;
        insertIndex = prefix.length;
        sectionHeading = '## Related notes';
    } else {
        const after = content.slice(section.index + section.heading.length);
        const nextHeading = after.search(/\n## /);
        sectionHeading = section.heading;
        if (nextHeading === -1) {
            const prefix = `${content.replace(/\s+$/, '')}\n`;
            nextContent = `${prefix}${link}\n`;
            insertIndex = prefix.length;
        } else {
            insertIndex = section.index + section.heading.length + nextHeading;
            const prefix = `${content.slice(0, insertIndex).replace(/\s+$/, '')}\n`;
            nextContent = `${prefix}${link}\n${content.slice(insertIndex)}`;
            insertIndex = prefix.length;
        }
    }

    return {
        content: nextContent,
        inserted: true,
        alreadyExists: false,
        sectionHeading,
        line: countLinesBefore(nextContent, insertIndex),
    };
}

function normalizeInputPath(input, context, label) {
    if (typeof input !== 'string' || !input.trim()) {
        throw new AgentApiError('INVALID_ARGUMENT', `${label} is required.`);
    }
    if (input.includes('\0')) {
        throw new AgentApiError('UNSAFE_PATH', `${label} contains an unsafe null byte.`);
    }

    const raw = toPosixPath(input.trim());
    const root = context.getVaultPath();

    if (root && path.isAbsolute(raw)) {
        const absolute = path.resolve(raw);
        if (!isInsidePath(root, absolute)) {
            throw new AgentApiError('UNSAFE_PATH', `${label} must stay inside the vault.`);
        }
        const relative = toPosixPath(path.relative(root, absolute));
        if (!relative || hasPathTraversal(relative)) {
            throw new AgentApiError('UNSAFE_PATH', `${label} must stay inside the vault.`);
        }
        return relative;
    }

    if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
        throw new AgentApiError('UNSAFE_PATH', `${label} must be relative to the vault.`);
    }

    const normalized = path.posix.normalize(raw).replace(/^\/+/, '');
    if (!normalized || normalized === '.' || hasPathTraversal(normalized)) {
        throw new AgentApiError('UNSAFE_PATH', `${label} must stay inside the vault.`);
    }

    if (root) {
        const absolute = path.resolve(root, normalized);
        if (!isInsidePath(root, absolute)) {
            throw new AgentApiError('UNSAFE_PATH', `${label} must stay inside the vault.`);
        }
    }

    return normalized;
}

function maybeNormalizeTargetPath(input, context) {
    const raw = String(input || '').trim();
    if (!raw) {
        throw new AgentApiError('INVALID_ARGUMENT', 'target is required.');
    }
    if (/[\\/]/.test(raw) || /\.md$/i.test(raw) || path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
        return normalizeInputPath(raw, context, 'target');
    }
    return raw;
}

function createFsAdapter(vaultPath) {
    const vaultRoot = normalizeVaultRoot(vaultPath);
    return {
        getVaultPath() {
            return vaultRoot;
        },
        async ensureVault() {
            if (!vaultRoot) {
                throw new AgentApiError('INVALID_ARGUMENT', 'vaultPath is required.');
            }
            try {
                const stat = await fs.promises.stat(vaultRoot);
                if (!stat.isDirectory()) {
                    throw new AgentApiError('VAULT_NOT_FOUND', ERROR_MESSAGES.VAULT_NOT_FOUND);
                }
            } catch (error) {
                if (error instanceof AgentApiError) throw error;
                throw new AgentApiError('VAULT_NOT_FOUND', ERROR_MESSAGES.VAULT_NOT_FOUND, error.message);
            }
        },
        resolve(relativePath) {
            const normalized = normalizeInputPath(relativePath, this, 'path');
            return path.resolve(vaultRoot, normalized);
        },
        getAbsolutePath(relativePath) {
            return this.resolve(relativePath);
        },
        async exists(relativePath) {
            await this.ensureVault();
            try {
                await fs.promises.access(this.resolve(relativePath));
                return true;
            } catch (error) {
                return false;
            }
        },
        async readText(relativePath) {
            await this.ensureVault();
            return fs.promises.readFile(this.resolve(relativePath), 'utf8');
        },
        async writeText(relativePath, content) {
            await this.ensureVault();
            const absolute = this.resolve(relativePath);
            await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
            await fs.promises.writeFile(absolute, String(content), 'utf8');
        },
        async mkdir(relativePath) {
            await this.ensureVault();
            await fs.promises.mkdir(this.resolve(relativePath), { recursive: true });
        },
        async stat(relativePath) {
            await this.ensureVault();
            const stat = await fs.promises.stat(this.resolve(relativePath));
            return { mtime: stat.mtimeMs };
        },
        trigger() {},
    };
}

function createObsidianAdapter(app, vaultPath) {
    const adapter = app && app.vault && app.vault.adapter;
    const vaultRoot = normalizeVaultRoot(vaultPath || (adapter && adapter.getBasePath && adapter.getBasePath()) || '');
    return {
        getVaultPath() {
            return vaultRoot;
        },
        async ensureVault() {
            if (!app || !app.vault || !adapter) {
                throw new AgentApiError('INVALID_ARGUMENT', 'Obsidian app/vault adapter is required.');
            }
        },
        async exists(relativePath) {
            await this.ensureVault();
            const normalized = normalizeInputPath(relativePath, this, 'path');
            if (adapter.exists) return !!(await adapter.exists(normalized));
            if (app.vault.getAbstractFileByPath && app.vault.getAbstractFileByPath(normalized)) return true;
            try {
                await adapter.read(normalized);
                return true;
            } catch (error) {
                return false;
            }
        },
        async readText(relativePath) {
            await this.ensureVault();
            const normalized = normalizeInputPath(relativePath, this, 'path');
            return adapter.read(normalized);
        },
        getAbsolutePath(relativePath) {
            const normalized = normalizeInputPath(relativePath, this, 'path');
            if (adapter.getFullPath) return adapter.getFullPath(normalized);
            return vaultRoot ? path.resolve(vaultRoot, normalized) : normalized;
        },
        async writeText(relativePath, content) {
            await this.ensureVault();
            const normalized = normalizeInputPath(relativePath, this, 'path');
            const file = app.vault.getAbstractFileByPath && app.vault.getAbstractFileByPath(normalized);
            if (file && app.vault.modify) {
                await app.vault.modify(file, String(content));
                return;
            }
            if (adapter.write) {
                await adapter.write(normalized, String(content));
                return;
            }
            throw new AgentApiError('INTERNAL_ERROR', 'Vault adapter does not support writes.');
        },
        async mkdir(relativePath) {
            await this.ensureVault();
            const normalized = normalizeInputPath(relativePath, this, 'path');
            if (adapter.exists && await adapter.exists(normalized)) return;
            if (adapter.mkdir) await adapter.mkdir(normalized);
        },
        async stat(relativePath) {
            await this.ensureVault();
            const normalized = normalizeInputPath(relativePath, this, 'path');
            const file = app.vault.getAbstractFileByPath && app.vault.getAbstractFileByPath(normalized);
            if (file && file.stat) return { mtime: file.stat.mtime || 0 };
            if (adapter.stat) {
                const stat = await adapter.stat(normalized);
                return { mtime: stat && (stat.mtime || stat.mtimeMs) || 0 };
            }
            return { mtime: 0 };
        },
        trigger(eventName, payload) {
            if (app.workspace && app.workspace.trigger) {
                app.workspace.trigger(eventName, payload);
            }
        },
    };
}

function groupMap(grouped) {
    const map = new Map();
    for (const [group, titles] of Object.entries(grouped || {})) {
        for (const title of Array.isArray(titles) ? titles : []) {
            map.set(String(title), group);
        }
    }
    return map;
}

function relationType(relation) {
    if (relation.type) return relation.type;
    if (relation.reason) return relation.reason;
    if (relation.source === 'backlink') return 'backlink';
    return 'semantic';
}

function relationSource(relation) {
    if (relation.source) return relation.source;
    if (relation.reason) return relation.reason;
    return 'understory';
}

const INTERNAL_RELATION_TARGET_PREFIXES = [
    '.obsidian/',
    '.understory/',
    '.trash/',
];

function isInternalRelationTarget(target) {
    const normalized = toPosixPath(target).replace(/^\/+/, '').toLowerCase();
    return INTERNAL_RELATION_TARGET_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function sanitizeRelations(relations) {
    if (!Array.isArray(relations)) return [];
    return relations.filter((relation) => relation && relation.target && !isInternalRelationTarget(relation.target));
}

function sanitizeStoreRelations(store) {
    let changed = false;
    if (!isObject(store.files)) return false;
    for (const entry of Object.values(store.files)) {
        if (!isObject(entry) || !Array.isArray(entry.relations)) continue;
        const sanitized = sanitizeRelations(entry.relations);
        if (sanitized.length !== entry.relations.length) {
            entry.relations = sanitized;
            changed = true;
        }
    }
    return changed;
}

function normalizeRelations(result) {
    const grouped = groupMap(result && result.grouped || {});
    const now = new Date().toISOString();
    const relations = Array.isArray(result && result.relations) ? result.relations : [];
    return relations.map((relation) => {
        const target = toPosixPath(relation.target || relation.path || relation.file || relation.title).replace(/^\/+/, '');
        const title = relation.title || target.split('/').pop().replace(/\.md$/i, '') || target;
        return {
            target,
            title,
            type: relationType(relation),
            score: Number(relation.score ?? relation.similarity ?? 0),
            group: relation.group || grouped.get(title) || grouped.get(target) || relationType(relation),
            status: relation.status || 'suggested',
            source: relationSource(relation),
            createdAt: relation.createdAt || now,
            updatedAt: now,
        };
    }).filter((relation) => relation.target && relation.title && !isInternalRelationTarget(relation.target));
}

function parseProcessJson(stdout) {
    const text = String(stdout || '').trim();
    if (!text) {
        throw new AgentApiError('PARSE_FAILED', ERROR_MESSAGES.PARSE_FAILED, 'Engine produced no JSON output.');
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
        for (const line of lines) {
            try {
                return JSON.parse(line);
            } catch (lineError) {
                // Keep looking for a JSON line.
            }
        }
        throw new AgentApiError('PARSE_FAILED', ERROR_MESSAGES.PARSE_FAILED, safeErrorDetail({
            message: error.message,
            stdout,
        }));
    }
}

function localEngineEnv(vaultPath) {
    return {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        OBSIDIAN_VAULT_PATH: vaultPath || process.env.OBSIDIAN_VAULT_PATH || '',
        UNDERSTORY_NETWORK_MODE: 'local',
        UNDERSTORY_WEBHOOK_ENABLED: '0',
        UNDERSTORY_WEBHOOK_URL: '',
        UNDERSTORY_OPENAI_API_KEY: '',
        UNDERSTORY_ZHIPU_API_KEY: '',
        UNDERSTORY_LLM_API_KEY: '',
        UNDERSTORY_EMBEDDING_API_KEY: '',
        OPENAI_API_KEY: '',
        ZHIPU_API_KEY: '',
        ANTHROPIC_API_KEY: '',
    };
}

function runPythonJson({ pythonPath, engineDir, apiPath, args, vaultPath, timeoutMs, settings }) {
    return new Promise((resolve, reject) => {
        const child = spawn(pythonPath, [apiPath, ...args], {
            cwd: engineDir,
            env: localEngineEnv(vaultPath),
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        const timer = timeoutMs ? setTimeout(() => {
            child.kill();
            reject(new AgentApiError('ENGINE_FAILED', 'Understory engine timed out.', safeErrorDetail({
                stdout,
                stderr,
                message: `Timed out after ${timeoutMs}ms`,
                settings,
            })));
        }, timeoutMs) : null;

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            if (timer) clearTimeout(timer);
            reject(new AgentApiError('ENGINE_FAILED', ERROR_MESSAGES.ENGINE_FAILED, safeErrorDetail({
                message: error.message,
                settings,
            })));
        });
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (code !== 0) {
                const engineMessage = extractProcessJsonMessage(stdout);
                reject(new AgentApiError('ENGINE_FAILED', ERROR_MESSAGES.ENGINE_FAILED, safeErrorDetail({
                    stdout,
                    stderr,
                    message: engineMessage
                        ? `api.py exited with code ${code}: ${engineMessage}`
                        : `api.py exited with code ${code}`,
                    settings,
                })));
                return;
            }
            try {
                resolve(parseProcessJson(stdout));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function createAgentApi(options = {}) {
    const settings = options.settings || {};
    const adapter = options.adapter
        || (options.app ? createObsidianAdapter(options.app, options.vaultPath) : createFsAdapter(options.vaultPath));
    const plugin = options.plugin || null;
    const engineDir = options.engineDir || process.env.UNDERSTORY_ENGINE_DIR || '';
    const pythonPath = options.pythonPath || process.env.UNDERSTORY_PYTHON_PATH || 'python';
    const refreshTimeoutMs = Number(options.refreshTimeoutMs || 120000);

    async function readJson(relativePath, fallback) {
        if (!(await adapter.exists(relativePath))) {
            return { exists: false, value: fallback };
        }
        try {
            const raw = await adapter.readText(relativePath);
            return { exists: true, value: raw ? JSON.parse(raw) : fallback };
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new AgentApiError('PARSE_FAILED', ERROR_MESSAGES.PARSE_FAILED, safeErrorDetail({
                    message: error.message,
                    settings,
                }));
            }
            throw error;
        }
    }

    async function writeJson(relativePath, data) {
        await adapter.mkdir('.understory');
        await adapter.writeText(relativePath, JSON.stringify(data, null, 2));
    }

    function emptyStore() {
        return { version: 1, indexedAt: new Date().toISOString(), files: {} };
    }

    async function readStore() {
        const result = await readJson(RELATIONS_PATH, emptyStore());
        const store = isObject(result.value) ? result.value : emptyStore();
        if (!isObject(store.files)) store.files = {};
        if (!store.version) store.version = 1;
        const sanitized = sanitizeStoreRelations(store);
        return { exists: result.exists, store, sanitized };
    }

    async function writeStore(store) {
        store.indexedAt = new Date().toISOString();
        await writeJson(RELATIONS_PATH, store);
    }

    async function assertNoteExists(notePath) {
        const normalized = normalizeInputPath(notePath, adapter, 'notePath');
        if (!(await adapter.exists(normalized))) {
            throw new AgentApiError('NOTE_NOT_FOUND', ERROR_MESSAGES.NOTE_NOT_FOUND);
        }
        return normalized;
    }

    function findRelation(entry, target) {
        const relations = Array.isArray(entry && entry.relations) ? entry.relations : [];
        return relations.find((relation) => relation && (
            relation.title === target || relation.target === target
        )) || null;
    }

    async function setRelationStatus(notePath, target, status) {
        if (typeof target !== 'string' || !target.trim()) {
            throw new AgentApiError('INVALID_ARGUMENT', 'target is required.');
        }
        const normalized = await assertNoteExists(notePath);
        const { exists, store } = await readStore();
        if (!exists) throw new AgentApiError('STORE_NOT_FOUND', ERROR_MESSAGES.STORE_NOT_FOUND);
        const entry = store.files[normalized];
        if (!entry) throw new AgentApiError('RELATION_NOT_FOUND', ERROR_MESSAGES.RELATION_NOT_FOUND);

        const relation = findRelation(entry, target);
        if (!relation) throw new AgentApiError('RELATION_NOT_FOUND', ERROR_MESSAGES.RELATION_NOT_FOUND);

        const now = new Date().toISOString();
        relation.status = status;
        relation.updatedAt = now;
        await writeStore(store);
        adapter.trigger('understory:relations-updated', normalized);
        return {
            notePath: normalized,
            target,
            matchedTitle: relation.title,
            matchedTarget: relation.target,
            status,
            updated: true,
        };
    }

    async function trySetRelationStatus(notePath, target, status) {
        try {
            return await setRelationStatus(notePath, target, status);
        } catch (error) {
            if (error instanceof AgentApiError && (
                error.code === 'STORE_NOT_FOUND' || error.code === 'RELATION_NOT_FOUND'
            )) {
                return null;
            }
            throw error;
        }
    }

    async function refreshWithExternalEngine(normalized) {
        if (!engineDir) {
            throw new AgentApiError('ENGINE_NOT_READY', ERROR_MESSAGES.ENGINE_NOT_READY, 'No engineDir or UNDERSTORY_ENGINE_DIR configured.');
        }
        const absoluteEngineDir = path.resolve(String(engineDir));
        const apiPath = path.join(absoluteEngineDir, 'api.py');
        try {
            await fs.promises.access(apiPath);
        } catch (error) {
            throw new AgentApiError('ENGINE_NOT_READY', ERROR_MESSAGES.ENGINE_NOT_READY, `api.py not found: ${apiPath}`);
        }

        const absoluteNotePath = adapter.getAbsolutePath
            ? adapter.getAbsolutePath(normalized)
            : path.resolve(adapter.getVaultPath(), normalized);
        const vaultPath = adapter.getVaultPath();
        const args = ['refresh-link', absoluteNotePath, '--no-auto-write'];
        if (vaultPath) args.push('--vault', vaultPath);
        const result = await runPythonJson({
            pythonPath,
            engineDir: absoluteEngineDir,
            apiPath,
            args,
            vaultPath,
            timeoutMs: refreshTimeoutMs,
            settings,
        });
        if (result && result.status === 'skipped') {
            const { store, sanitized } = await readStore();
            if (sanitized) {
                await writeStore(store);
                adapter.trigger('understory:relations-updated', normalized);
            }
            const entry = store.files[normalized] || null;
            const relations = entry && Array.isArray(entry.relations) ? entry.relations : [];
            return {
                notePath: normalized,
                status: 'skipped',
                reason: result.reason || '',
                unchanged: !!result.unchanged,
                dryRun: false,
                relationsCount: relations.length,
                entry,
            };
        }
        if (!result || result.status !== 'ok') {
            throw new AgentApiError('ENGINE_FAILED', ERROR_MESSAGES.ENGINE_FAILED, safeErrorDetail({
                message: result && result.error || 'Engine did not return ok status.',
                settings,
            }));
        }

        const [content, stat] = await Promise.all([
            adapter.readText(normalized),
            adapter.stat(normalized),
        ]);
        const relations = normalizeRelations(result);
        const { store } = await readStore();
        const indexedAt = new Date().toISOString();
        store.files[normalized] = {
            hash: hashContent(content),
            mtime: stat.mtime,
            indexedAt,
            relations,
        };
        await writeStore(store);
        adapter.trigger('understory:relations-updated', normalized);
        return {
            notePath: normalized,
            status: 'ok',
            dryRun: false,
            relationsCount: relations.length,
            entry: store.files[normalized],
        };
    }

    async function run(operation) {
        try {
            await adapter.ensureVault();
            const data = await operation();
            return ok(data, adapter, settings);
        } catch (error) {
            return errorEnvelope(error, adapter, settings);
        }
    }

    function safeVaultPath() {
        return adapter.getVaultPath()
            ? redactConfiguredSecrets(toPosixPath(adapter.getVaultPath()), settings)
            : '';
    }

    async function listMarkdownNotePaths() {
        const seen = new Set();
        const vault = options.app && options.app.vault;
        if (vault && typeof vault.getMarkdownFiles === 'function') {
            for (const file of vault.getMarkdownFiles()) {
                if (file && file.path && !file.path.startsWith('.understory/')) seen.add(toPosixPath(file.path));
            }
        }

        const vaultRoot = adapter.getVaultPath && adapter.getVaultPath();
        if (vaultRoot) {
            async function walk(relativeDir = '') {
                const absoluteDir = path.join(vaultRoot, ...relativeDir.split('/').filter(Boolean));
                let entries = [];
                try {
                    entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
                } catch (error) {
                    return;
                }
                for (const entry of entries) {
                    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) {
                        if (entry.name === '.obsidian' || entry.name === '.understory') continue;
                        await walk(relativePath);
                    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
                        seen.add(toPosixPath(relativePath));
                    }
                }
            }
            await walk('');
        }

        return [...seen].sort((a, b) => a.localeCompare(b));
    }

    function relationMatches(entry, terms) {
        const relations = Array.isArray(entry && entry.relations) ? entry.relations : [];
        const matches = [];
        for (const relation of relations) {
            const text = relationText(relation).toLowerCase();
            if (terms.some((term) => text.includes(term))) matches.push(relation);
        }
        return matches;
    }

    async function buildNoteBrief(notePath, store, query) {
        const normalized = normalizeInputPath(notePath, adapter, 'notePath');
        const [content, stat] = await Promise.all([
            adapter.readText(normalized),
            adapter.stat(normalized).catch(() => ({ mtime: 0 })),
        ]);
        const entry = store.files[normalized] || null;
        const relations = Array.isArray(entry && entry.relations) ? entry.relations : [];
        return {
            path: normalized,
            title: noteTitleFromPath(normalized),
            snippet: compactSnippet(content, query),
            relationCount: relations.length,
            relations: relations.slice(0, 8).map((relation) => ({
                target: relation.target || '',
                title: relation.title || titleFromTarget(relation.target || ''),
                type: relation.type || '',
                status: relation.status || 'suggested',
                score: relation.score,
            })),
            indexedAt: entry && entry.indexedAt || '',
            mtime: stat.mtime || 0,
        };
    }

    async function searchLocal({ query, limit } = {}) {
        const terms = searchTerms(query);
        if (!terms.length) {
            throw new AgentApiError('INVALID_ARGUMENT', 'query must contain at least one searchable term.');
        }
        const maxResults = clampLimit(limit);
        const { store } = await readStore();
        const paths = new Set([
            ...Object.keys(store.files || {}),
            ...(await listMarkdownNotePaths()),
        ]);
        const results = [];

        for (const notePath of paths) {
            let content = '';
            try {
                if (!(await adapter.exists(notePath))) continue;
                content = await adapter.readText(notePath);
            } catch (error) {
                continue;
            }
            const entry = store.files[notePath] || null;
            const title = noteTitleFromPath(notePath);
            const haystacks = {
                title: title.toLowerCase(),
                path: notePath.toLowerCase(),
                body: stripMarkdownNoise(content).toLowerCase(),
            };
            let score = 0;
            const reasons = [];
            for (const term of terms) {
                if (haystacks.title.includes(term)) {
                    score += 6;
                    reasons.push('title');
                }
                if (haystacks.path.includes(term)) {
                    score += 3;
                    reasons.push('path');
                }
                if (haystacks.body.includes(term)) {
                    score += 2;
                    reasons.push('content snippet');
                }
            }
            const relationHits = relationMatches(entry, terms);
            if (relationHits.length) {
                score += relationHits.length * 4;
                reasons.push('relations graph');
            }
            if (!score) continue;
            const brief = await buildNoteBrief(notePath, store, query);
            results.push({
                path: brief.path,
                title: brief.title,
                snippet: brief.snippet,
                why: [...new Set(reasons)].join(', '),
                score,
                relationCount: brief.relationCount,
                matchedRelations: relationHits.slice(0, 5).map((relation) => ({
                    target: relation.target || '',
                    title: relation.title || titleFromTarget(relation.target || ''),
                    type: relation.type || '',
                    status: relation.status || 'suggested',
                })),
            });
        }

        results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
        return {
            query,
            mode: 'local_keyword_relations',
            limit: maxResults,
            results: results.slice(0, maxResults),
        };
    }

    return {
        async getCapabilities() {
            return run(async () => ({
                apiVersion: API_VERSION,
                transport: 'cli_or_mcp_stdio',
                privacy: {
                    networkMode: safeNetworkMode(settings.networkMode),
                    opensHttpPort: false,
                    sendsDataToBondieLabs: false,
                    returnsFullNoteBodiesByDefault: false,
                },
                tools: {
                    read: [
                        'understory_status',
                        'understory_get_capabilities',
                        'understory_graph_summary',
                        'understory_get_relations',
                        'understory_search',
                        'understory_get_context',
                        'understory_get_note_brief',
                    ],
                    write: [
                        'understory_refresh_relations',
                        'understory_accept_relation',
                        'understory_reject_relation',
                        'understory_insert_relation',
                    ],
                },
                writeSafety: 'Write tools modify local vault metadata or note content and require user confirmation.',
            }));
        },

        async status() {
            return run(async () => {
                const { exists, store } = await readStore();
                const files = isObject(store.files) ? Object.values(store.files) : [];
                const relationCount = files.reduce((count, entry) => (
                    count + (Array.isArray(entry && entry.relations) ? entry.relations.length : 0)
                ), 0);
                const engineHealth = plugin && plugin.engineHealth ? plugin.engineHealth : null;
                return {
                    status: 'ok',
                    vaultPath: safeVaultPath(),
                    networkMode: safeNetworkMode(settings.networkMode),
                    relationsStore: {
                        exists,
                        fileCount: files.length,
                        relationCount,
                    },
                    engine: engineHealth ? {
                        status: engineHealth.status || (engineHealth.ok ? 'ready' : 'problem'),
                        message: redactSensitiveText(engineHealth.message || '', settings),
                    } : {
                        status: 'not_checked',
                    },
                };
            });
        },

        async getRelations({ notePath } = {}) {
            return run(async () => {
                const normalized = await assertNoteExists(notePath);
                const { store } = await readStore();
                const entry = store.files[normalized] || null;
                if (!entry) {
                    return {
                        notePath: normalized,
                        status: 'missing',
                        stale: true,
                        relations: [],
                        entry: null,
                    };
                }
                let stale = false;
                try {
                    const [content, stat] = await Promise.all([
                        adapter.readText(normalized),
                        adapter.stat(normalized),
                    ]);
                    stale = entry.hash !== hashContent(content)
                        || Number(entry.mtime || 0) !== Number(stat.mtime || 0);
                } catch (error) {
                    stale = false;
                }
                return {
                    notePath: normalized,
                    status: 'ok',
                    stale,
                    relations: Array.isArray(entry.relations) ? entry.relations : [],
                    entry,
                };
            });
        },

        async search({ query, limit } = {}) {
            return run(async () => searchLocal({ query, limit }));
        },

        async getNoteBrief({ notePath } = {}) {
            return run(async () => {
                const normalized = await assertNoteExists(notePath);
                const { store } = await readStore();
                const brief = await buildNoteBrief(normalized, store, '');
                return {
                    ...brief,
                    bodyIncluded: false,
                };
            });
        },

        async getContext({ query, notePath, limit } = {}) {
            return run(async () => {
                const maxResults = clampLimit(limit, 6, 12);
                if (notePath) {
                    const normalized = await assertNoteExists(notePath);
                    const { store } = await readStore();
                    const source = await buildNoteBrief(normalized, store, query || '');
                    const related = [];
                    for (const relation of source.relations) {
                        if (!relation.target) continue;
                        try {
                            if (await adapter.exists(relation.target)) {
                                related.push(await buildNoteBrief(relation.target, store, query || ''));
                            }
                        } catch (error) {
                            // Relations may point to aliases or notes that are not present locally.
                        }
                        if (related.length >= maxResults - 1) break;
                    }
                    return {
                        mode: 'note_relations_context',
                        query: query || '',
                        source,
                        items: [source, ...related].slice(0, maxResults),
                        bodyIncluded: false,
                    };
                }

                const search = await searchLocal({ query, limit: maxResults });
                return {
                    mode: 'search_context',
                    query,
                    items: search.results,
                    bodyIncluded: false,
                };
            });
        },

        async refreshRelations({ notePath, dryRun = false } = {}) {
            return run(async () => {
                const normalized = await assertNoteExists(notePath);
                if (dryRun) {
                    return {
                        notePath: normalized,
                        dryRun: true,
                        status: 'skipped',
                    };
                }
                if (options.relationsStore && options.app && options.app.vault && options.app.vault.getAbstractFileByPath) {
                    const file = options.app.vault.getAbstractFileByPath(normalized);
                    if (!file) throw new AgentApiError('NOTE_NOT_FOUND', ERROR_MESSAGES.NOTE_NOT_FOUND);
                    const result = await options.relationsStore.discoverAndCache(file, true);
                    return {
                        notePath: normalized,
                        status: result && result.status || 'ok',
                        result,
                    };
                }
                return refreshWithExternalEngine(normalized);
            });
        },

        async acceptRelation({ notePath, target } = {}) {
            return run(async () => setRelationStatus(notePath, target, 'accepted'));
        },

        async rejectRelation({ notePath, target } = {}) {
            return run(async () => {
                const mutation = await setRelationStatus(notePath, target, 'rejected');
                const overridesResult = await readJson(OVERRIDES_PATH, {});
                const overrides = isObject(overridesResult.value) ? overridesResult.value : {};
                if (!overrides[mutation.notePath]) overrides[mutation.notePath] = {};
                if (!isObject(overrides[mutation.notePath].tombstones)) {
                    overrides[mutation.notePath].tombstones = {};
                }
                overrides[mutation.notePath].tombstones[mutation.matchedTitle || target] = {
                    action: 'deleted',
                    at: new Date().toISOString(),
                    ttl_days: 30,
                    target_hash: '',
                };
                await writeJson(OVERRIDES_PATH, overrides);
                return {
                    ...mutation,
                    tombstone: true,
                };
            });
        },

        async insertRelation({ notePath, target, title } = {}) {
            return run(async () => {
                const normalized = await assertNoteExists(notePath);
                const safeTarget = maybeNormalizeTargetPath(target, adapter);
                const linkTitle = cleanLinkTitle(title) || titleFromTarget(safeTarget);
                if (!linkTitle) {
                    throw new AgentApiError('INVALID_ARGUMENT', 'title or target must produce a link title.');
                }
                const link = `[[${linkTitle}]]`;
                const content = await adapter.readText(normalized);
                const insertion = insertLinkIntoContent(content, link);
                if (insertion.inserted) {
                    await adapter.writeText(normalized, insertion.content);
                }
                const relationMutation = insertion.inserted
                    ? await trySetRelationStatus(normalized, safeTarget, 'accepted')
                        || await trySetRelationStatus(normalized, linkTitle, 'accepted')
                    : null;
                return {
                    notePath: normalized,
                    target: safeTarget,
                    title: linkTitle,
                    link,
                    inserted: insertion.inserted,
                    alreadyExists: insertion.alreadyExists,
                    sectionHeading: insertion.sectionHeading,
                    line: insertion.line,
                    relationUpdated: !!relationMutation,
                };
            });
        },

        async getGraphSummary() {
            return run(async () => {
                const relations = await readStore();
                const files = isObject(relations.store.files) ? Object.values(relations.store.files) : [];
                const relationCount = files.reduce((count, entry) => (
                    count + (Array.isArray(entry && entry.relations) ? entry.relations.length : 0)
                ), 0);
                const conflictsResult = await readJson(CONFLICTS_PATH, null);
                const conflicts = summarizeConflicts(conflictsResult.value);
                const indexExists = await adapter.exists(INDEX_PATH);
                return {
                    vaultPath: safeVaultPath(),
                    relationsStore: {
                        exists: relations.exists,
                        fileCount: files.length,
                        relationCount,
                        updatedAt: relations.store.indexedAt || '',
                    },
                    conflicts: {
                        exists: conflictsResult.exists,
                        openCount: conflicts.openCount,
                        highCount: conflicts.highCount,
                    },
                    index: {
                        exists: indexExists,
                        path: INDEX_PATH,
                    },
                };
            });
        },
    };
}

function summarizeConflicts(value) {
    const items = [];
    if (Array.isArray(value)) {
        items.push(...value);
    } else if (isObject(value)) {
        if (Array.isArray(value.conflicts)) items.push(...value.conflicts);
        for (const [key, item] of Object.entries(value)) {
            if (key === 'conflicts') continue;
            if (Array.isArray(item)) items.push(...item);
            else if (isObject(item) && (item.status || item.severity)) items.push(item);
        }
    }

    let openCount = 0;
    let highCount = 0;
    for (const item of items) {
        const status = String(item && item.status || '').toLowerCase();
        const severity = String(item && (item.severity || item.level) || '').toLowerCase();
        if (status !== 'resolved' && status !== 'closed') openCount += 1;
        if (severity === 'high' || severity === 'critical') highCount += 1;
    }
    return { openCount, highCount };
}

module.exports = {
    AgentApiError,
    ERROR_MESSAGES,
    OVERRIDES_PATH,
    RELATIONS_PATH,
    createAgentApi,
};
