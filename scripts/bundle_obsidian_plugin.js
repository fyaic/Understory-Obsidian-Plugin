#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Node release build script is intentionally CommonJS so npm build works in the same package mode as the plugin source. */

const base64 = (buffer) => buffer.toString('base64');
const cryptoModule = require('crypto');
const fs = require('fs');
const path = require('path');

const VIRTUAL_AGENT_ACCESS_SOURCES = 'agentAccessBundledSources.js';
const VIRTUAL_BUNDLED_ENGINE_PAYLOAD = 'bundledEnginePayload.js';
const SOURCE_MODULE_EXCLUDES = new Set([
    VIRTUAL_AGENT_ACCESS_SOURCES,
    VIRTUAL_BUNDLED_ENGINE_PAYLOAD,
]);
const ENGINE_DIR_NAME = 'understory-graphify-engine';
const EXCLUDED_ENGINE_NAMES = new Set([
    '.cache',
    '.env',
    '.git',
    '.pytest_cache',
    '.serena',
    '__pycache__',
    'config.yaml',
]);
const EXCLUDED_ENGINE_SUFFIXES = new Set(['.db', '.pyc', '.sqlite']);

function moduleId(filename) {
    return `./${filename.replace(/\\/g, '/').replace(/\.js$/, '')}`;
}

function toPosixRelative(root, candidate) {
    return path.relative(root, candidate).split(path.sep).join('/');
}

function readTextNormalized(filename) {
    return fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function releaseBytes(filename) {
    const data = fs.readFileSync(filename);
    if (data.includes(0)) return data;

    const normalized = [];
    for (let index = 0; index < data.length; index += 1) {
        const byte = data[index];
        if (byte === 13) {
            if (data[index + 1] === 10) index += 1;
            normalized.push(10);
        } else {
            normalized.push(byte);
        }
    }
    return Buffer.from(normalized);
}

function sourceModules(pluginDir) {
    const modules = fs.readdirSync(pluginDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js') && !SOURCE_MODULE_EXCLUDES.has(entry.name))
        .map((entry) => path.join(pluginDir, entry.name))
        .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));

    if (!modules.some((filename) => path.basename(filename) === 'main.js')) {
        throw new Error(`Plugin entrypoint is missing: ${path.join(pluginDir, 'main.js')}`);
    }
    return modules;
}

function includeEngineFile(relativePath) {
    const parts = relativePath.split('/');
    if (parts.some((part) => EXCLUDED_ENGINE_NAMES.has(part))) return false;
    return !EXCLUDED_ENGINE_SUFFIXES.has(path.extname(relativePath).toLowerCase());
}

function walkFiles(rootDir) {
    const results = [];
    const stack = [rootDir];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile()) {
                results.push(fullPath);
            }
        }
    }
    return results.sort((left, right) => toPosixRelative(rootDir, left).localeCompare(toPosixRelative(rootDir, right)));
}

function sha256(data) {
    return cryptoModule.createHash('sha256').update(data).digest('hex');
}

function buildBundledEnginePayload(rootDir) {
    const engineDir = path.join(rootDir, ENGINE_DIR_NAME);
    if (!fs.existsSync(engineDir)) {
        throw new Error(`Bundled engine directory is missing: ${engineDir}`);
    }

    const files = [];
    for (const filename of walkFiles(engineDir)) {
        const relativePath = toPosixRelative(engineDir, filename);
        if (!includeEngineFile(relativePath)) continue;
        const data = releaseBytes(filename);
        files.push({
            path: relativePath,
            contentBase64: base64(data),
            sha256: sha256(data),
        });
    }

    const included = new Set(files.map((file) => file.path));
    const missing = [
        'api.py',
        'scripts/deploy_graphify.py',
        'requirements.txt',
    ].filter((required) => !included.has(required));
    if (missing.length) {
        throw new Error(`Bundled engine payload is missing required files: ${missing.join(', ')}`);
    }

    return {
        version: 1,
        engineDirName: ENGINE_DIR_NAME,
        files,
    };
}

function buildBundle(pluginDir) {
    const blocks = [];
    for (const filename of sourceModules(pluginDir)) {
        const source = readTextNormalized(filename);
        blocks.push(`${JSON.stringify(moduleId(path.basename(filename)))}: function(module, exports, require) {\n${source}\n}`);
    }

    const rootDir = path.resolve(pluginDir, '..');
    const bundledSources = {
        agentApiSource: readTextNormalized(path.join(pluginDir, 'agentApi.js')),
        safetySource: readTextNormalized(path.join(pluginDir, 'safety.js')),
        mcpServerSource: readTextNormalized(path.join(rootDir, 'scripts', 'understory-mcp-server.js')),
    };
    const virtualSource = `module.exports = ${JSON.stringify(bundledSources)};`;
    blocks.push(
        `${JSON.stringify(moduleId(VIRTUAL_AGENT_ACCESS_SOURCES))}: `
        + `function(module, exports, require) {\n${virtualSource}\n}`
    );

    const enginePayloadSource = `module.exports = ${JSON.stringify(buildBundledEnginePayload(rootDir))};`;
    blocks.push(
        `${JSON.stringify(moduleId(VIRTUAL_BUNDLED_ENGINE_PAYLOAD))}: `
        + `function(module, exports, require) {\n${enginePayloadSource}\n}`
    );

    const joined = blocks.join(',\n\n');
    return `// Generated by scripts/bundle_obsidian_plugin.js. Do not edit this file directly.
(function() {
const __rootRequire = typeof require === 'function' ? require : null;
const __modules = {
${joined}
};
const __cache = {};
function __normalize(id) {
    if (id.endsWith('.js')) id = id.slice(0, -3);
    id = id.replace(/\\\\/g, '/');
    return id;
}
function __require(id) {
    const key = __normalize(id);
    if (Object.prototype.hasOwnProperty.call(__modules, key)) {
        if (__cache[key]) return __cache[key].exports;
        const module = { exports: {} };
        __cache[key] = module;
        __modules[key](module, module.exports, __require);
        return module.exports;
    }
    if (__rootRequire) return __rootRequire(id);
    throw new Error('Cannot resolve module: ' + id);
}
const __entry = { exports: {} };
__modules['./main'](__entry, __entry.exports, __require);
module.exports = __entry.exports;
})();
`;
}

function parseArgs(argv) {
    const args = { pluginDir: 'obsidian-plugin', out: '' };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--plugin-dir') {
            args.pluginDir = argv[index + 1] || '';
            index += 1;
        } else if (arg === '--out') {
            args.out = argv[index + 1] || '';
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!args.out) throw new Error('--out is required');
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const pluginDir = path.resolve(args.pluginDir);
    const out = path.resolve(args.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buildBundle(pluginDir), { encoding: 'utf8' });
    process.stdout.write(`${out}\n`);
}

if (require.main === module) {
    main();
}

module.exports = {
    buildBundle,
    buildBundledEnginePayload,
    includeEngineFile,
    releaseBytes,
    sourceModules,
};

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End Node release build script bridge. */
