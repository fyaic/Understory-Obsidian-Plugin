/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bundledEnginePayload = require('./bundledEnginePayload');

const ENGINE_DIR_NAME = 'understory-graphify-engine';
const DEFAULT_PLUGIN_ID = 'understory';

function vaultBasePath(app) {
    const adapter = app?.vault?.adapter;
    try {
        if (adapter && typeof adapter.getBasePath === 'function') {
            return String(adapter.getBasePath() || '').trim();
        }
    } catch {
        return '';
    }
    return String(adapter?.basePath || '').trim();
}

function configDirName(app) {
    return String(app?.vault?.configDir || '').trim();
}

function pluginId(plugin) {
    const manifestId = String(plugin?.manifest?.id || '').trim();
    if (manifestId) return manifestId;
    const manifestDir = String(plugin?.manifest?.dir || '').trim();
    if (manifestDir) return path.basename(manifestDir);
    return DEFAULT_PLUGIN_ID;
}

function fallbackPluginDir() {
    if (typeof __dirname !== 'string' || !__dirname) return '';
    return path.basename(__dirname).toLowerCase() === 'src'
        ? path.dirname(__dirname)
        : __dirname;
}

function pluginInstallDir(plugin, options = {}) {
    if (options.pluginDir) return path.resolve(String(options.pluginDir));

    const manifestDir = String(plugin?.manifest?.dir || '').trim();
    if (manifestDir) {
        if (path.isAbsolute(manifestDir)) return manifestDir;
        const base = options.vaultBasePath || vaultBasePath(plugin?.app);
        if (base) return path.resolve(base, manifestDir);
    }

    const base = options.vaultBasePath || vaultBasePath(plugin?.app);
    const configDir = configDirName(plugin?.app);
    if (base && configDir) {
        return path.resolve(base, configDir, 'plugins', pluginId(plugin));
    }

    return path.resolve(fallbackPluginDir() || '.');
}

function bundledEngineTargetDir(plugin, options = {}) {
    return path.join(pluginInstallDir(plugin, options), ENGINE_DIR_NAME);
}

function safePayloadParts(relativePath) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').trim();
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        throw new Error(`Unsafe bundled engine path: ${relativePath}`);
    }
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
        throw new Error(`Unsafe bundled engine path: ${relativePath}`);
    }
    return parts;
}

function sha256(buffer) {
    return nodeCrypto.createHash('sha256').update(buffer).digest('hex');
}

async function fileMatches(targetPath, expectedSha256, fsImpl = fs) {
    if (!expectedSha256 || !fsImpl.existsSync(targetPath)) return false;
    const existing = await fsImpl.promises.readFile(targetPath);
    return sha256(existing) === expectedSha256;
}

function payloadFiles(payload) {
    return Array.isArray(payload?.files) ? payload.files : [];
}

function decodePayloadFile(file) {
    const encoded = String(file?.contentBase64 || '');
    if (!encoded) return Buffer.alloc(0);
    return Buffer.from(encoded, 'base64');
}

async function ensureBundledEngine(plugin, options = {}) {
    const payload = options.payload || bundledEnginePayload;
    const files = payloadFiles(payload);
    const fsImpl = options.fs || fs;
    const engineDir = bundledEngineTargetDir(plugin, options);

    if (!files.length) {
        return { ok: false, reason: 'empty-payload', engineDir, files: 0, updated: 0 };
    }

    const root = path.resolve(engineDir);
    await fsImpl.promises.mkdir(root, { recursive: true });

    let updated = 0;
    for (const file of files) {
        const parts = safePayloadParts(file.path);
        const targetPath = path.resolve(root, ...parts);
        const relative = path.relative(root, targetPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`Unsafe bundled engine path: ${file.path}`);
        }

        const data = decodePayloadFile(file);
        if (file.sha256 && sha256(data) !== file.sha256) {
            throw new Error(`Bundled engine payload hash mismatch: ${file.path}`);
        }
        if (await fileMatches(targetPath, file.sha256, fsImpl)) continue;

        await fsImpl.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fsImpl.promises.writeFile(targetPath, data);
        updated += 1;
    }

    return {
        ok: true,
        engineDir: root,
        files: files.length,
        updated,
        payloadVersion: payload.version || 1,
        generatedAt: payload.generatedAt || '',
    };
}

module.exports = {
    ENGINE_DIR_NAME,
    bundledEngineTargetDir,
    ensureBundledEngine,
    pluginInstallDir,
    safePayloadParts,
};

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
