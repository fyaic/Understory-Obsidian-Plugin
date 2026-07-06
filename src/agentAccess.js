const fs = require('fs');
const path = require('path');
const { redactSensitiveText } = require('./safety');

const AGENT_DIR = '.understory/agent';
const MCP_SERVER_FILENAME = 'understory-mcp-server.js';
const SKILL_FILENAME = 'understory-skill.md';
const SERVER_KEY_PREFIX = 'understory-';

const AGENT_PROFILES = {
    generic: {
        id: 'generic',
        label: 'Generic MCP',
        installHint: 'Paste this JSON into any MCP client that supports stdio. Keep the MCP server key unique for this vault.',
        zh: {
            label: '通用 MCP',
            installHint: '把这段 JSON 粘贴到任何支持 stdio 的 MCP 客户端。请为这个 vault 保留独立的 MCP server key。',
        },
    },
    codex: {
        id: 'codex',
        label: 'Codex',
        installHint: 'Add this entry to Codex MCP configuration for this vault. Keep it alongside other vault entries instead of renaming it to a global "understory" key.',
        zh: {
            label: 'Codex',
            installHint: '把这个 entry 加入 Codex 的 MCP 配置。它只对应当前 vault，请和其他 vault entry 并列保存，不要改成全局 understory key。',
        },
    },
    claude: {
        id: 'claude',
        label: 'Claude Desktop',
        installHint: 'Paste the server entry into Claude Desktop MCP configuration. Repeat setup inside each Obsidian vault you want Claude to access.',
        zh: {
            label: 'Claude Desktop',
            installHint: '把 server entry 粘贴到 Claude Desktop 的 MCP 配置。每个需要 Claude 访问的 Obsidian vault 都要分别重复设置。',
        },
    },
    cursor: {
        id: 'cursor',
        label: 'Cursor',
        installHint: 'Use this as a Cursor MCP server entry for the current vault. If you configure multiple vaults, keep each vault-specific server key.',
        zh: {
            label: 'Cursor',
            installHint: '把这段配置作为当前 vault 的 Cursor MCP server entry。配置多个 vault 时，请保留每个 vault 自己的 server key。',
        },
    },
    openclaw: {
        id: 'openclaw',
        label: 'OpenClaw',
        installHint: 'Give OpenClaw this MCP entry and the matching Skill prompt so it calls the current vault through the matching server key.',
        zh: {
            label: 'OpenClaw',
            installHint: '把这个 MCP entry 和匹配的 Skill prompt 给 OpenClaw，让它通过对应 server key 调用当前 vault。',
        },
    },
};

const USAGE_MODES = {
    query: {
        id: 'query',
        label: 'Query-only',
        installHint: 'Use this Skill when you only want the agent to query this vault after you explicitly ask for vault search, citation, or summary.',
    },
    memory: {
        id: 'memory',
        label: 'Agent memory model',
        installHint: 'Use this Skill when you want the agent to treat this vault as active local context and a long-term memory layer for ongoing work.',
    },
};

function normalizeMcpPath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function pathBasename(value) {
    const normalized = normalizeMcpPath(value).replace(/\/+$/, '');
    if (!normalized) return '';
    const parts = normalized.split('/');
    return parts[parts.length - 1] || '';
}

function readVaultName(app) {
    const vault = app && app.vault;
    if (!vault) return '';
    if (typeof vault.getName === 'function') return vault.getName() || '';
    return vault.name || '';
}

function shortHash(value) {
    const input = String(value || 'understory-vault');
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function slugifyVaultName(value) {
    const normalized = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return normalized
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48)
        .replace(/^-|-$/g, '');
}

function normalizeServerKeyOverride(value) {
    let key = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!key || key === 'understory') return null;
    if (!key.startsWith(SERVER_KEY_PREFIX)) key = `${SERVER_KEY_PREFIX}${key}`;
    return key;
}

function createServerKey(vaultSlug, options = {}) {
    const override = normalizeServerKeyOverride(options.serverKey);
    if (override) {
        return {
            collisionSuffix: '',
            serverKey: override,
            warning: String(options.serverKey).startsWith(SERVER_KEY_PREFIX) ? '' : 'server_key_prefix_added',
        };
    }

    let slug = slugifyVaultName(vaultSlug);
    const hashSource = options.hashSource || vaultSlug || 'understory-vault';
    if (!slug) slug = `vault-${shortHash(hashSource)}`;
    if (slug.length < 3) slug = `${slug}-${shortHash(hashSource).slice(0, 4)}`;

    let serverKey = `${SERVER_KEY_PREFIX}${slug}`;
    let collisionSuffix = '';
    const existing = new Set(options.existingServerKeys || []);
    if (existing.has(serverKey)) {
        collisionSuffix = shortHash(hashSource).slice(0, 6);
        serverKey = `${serverKey}-${collisionSuffix}`;
    }

    return {
        collisionSuffix,
        serverKey,
        warning: '',
    };
}

function getVaultBasePath(app) {
    const adapter = app && app.vault && app.vault.adapter;
    if (!adapter) return '';
    if (typeof adapter.getBasePath === 'function') return adapter.getBasePath() || '';
    return adapter.basePath || adapter.vaultPath || '';
}

function createVaultIdentity(appOrVaultPath, options = {}) {
    const vaultPath = options.vaultPath || (typeof appOrVaultPath === 'string'
        ? appOrVaultPath
        : getVaultBasePath(appOrVaultPath));
    const vaultName = String(
        options.vaultName
        || (typeof appOrVaultPath === 'string' ? '' : readVaultName(appOrVaultPath))
        || pathBasename(vaultPath)
        || 'Current vault'
    ).trim();
    let vaultSlug = slugifyVaultName(options.vaultSlug || vaultName);
    let serverKeySource = vaultSlug ? 'vault-name' : 'path-hash';
    const hashSource = normalizeMcpPath(vaultPath) || vaultName;
    if (!vaultSlug) vaultSlug = `vault-${shortHash(hashSource)}`;
    if (vaultSlug.length < 3) vaultSlug = `${vaultSlug}-${shortHash(hashSource).slice(0, 4)}`;

    const serverKeyResult = createServerKey(vaultSlug, {
        existingServerKeys: options.existingServerKeys,
        hashSource,
        serverKey: options.serverKey,
    });
    if (options.serverKey) serverKeySource = 'manual';

    return {
        collisionSuffix: serverKeyResult.collisionSuffix,
        serverKey: serverKeyResult.serverKey,
        serverKeySource,
        serverKeyWarning: serverKeyResult.warning,
        status: vaultPath ? 'ready' : 'missing_path',
        vaultName,
        vaultPath: vaultPath || '',
        vaultSlug,
    };
}

function resolveVaultIdentity(options = {}) {
    if (options.vaultIdentity) return options.vaultIdentity;
    return createVaultIdentity(options.vaultPath || '', options);
}

function resolveAgentProfile(profileId) {
    return AGENT_PROFILES[profileId] || AGENT_PROFILES.generic;
}

function languageId(value) {
    return String(value || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function localizeAgentProfile(profile, language) {
    const resolved = profile || AGENT_PROFILES.generic;
    if (languageId(language) !== 'zh' || !resolved.zh) return resolved;
    return {
        ...resolved,
        label: resolved.zh.label || resolved.label,
        installHint: resolved.zh.installHint || resolved.installHint,
    };
}

function agentProfilesForLanguage(language) {
    const profiles = {};
    for (const [id, profile] of Object.entries(AGENT_PROFILES)) {
        profiles[id] = localizeAgentProfile(profile, language);
    }
    return profiles;
}

function resolveUsageMode(modeId) {
    return USAGE_MODES[modeId] || USAGE_MODES.memory;
}

function createAgentAccessPaths(appOrVaultPath) {
    const vaultIdentity = createVaultIdentity(appOrVaultPath);
    const vaultPath = vaultIdentity.vaultPath;
    const agentDir = vaultPath ? path.join(vaultPath, AGENT_DIR) : AGENT_DIR;
    return {
        vaultPath,
        vaultIdentity,
        vaultName: vaultIdentity.vaultName,
        vaultSlug: vaultIdentity.vaultSlug,
        serverKey: vaultIdentity.serverKey,
        agentDir,
        mcpServerPath: path.join(agentDir, MCP_SERVER_FILENAME),
        skillPath: path.join(agentDir, SKILL_FILENAME),
        skillVaultPath: `${AGENT_DIR}/${SKILL_FILENAME}`,
        mcpServerVaultPath: `${AGENT_DIR}/${MCP_SERVER_FILENAME}`,
    };
}

function createMcpConfig(options = {}) {
    const args = [normalizeMcpPath(options.mcpServerPath || `${AGENT_DIR}/${MCP_SERVER_FILENAME}`)];
    if (options.vaultPath) args.push('--vault', normalizeMcpPath(options.vaultPath));
    if (options.engineDir) args.push('--engine-dir', normalizeMcpPath(options.engineDir));
    args.push('--python-path', options.pythonPath || 'python');

    return {
        command: 'node',
        args,
    };
}

function formatMcpConfig(options = {}) {
    const vaultIdentity = resolveVaultIdentity(options);
    const serverKey = options.serverKey || vaultIdentity.serverKey;
    return JSON.stringify({
        mcpServers: {
            [serverKey]: createMcpConfig({
                ...options,
                vaultPath: vaultIdentity.vaultPath || options.vaultPath,
            }),
        },
    }, null, 2);
}

function createAgentInstallNotes(options = {}) {
    const vaultIdentity = resolveVaultIdentity(options);
    const profile = localizeAgentProfile(resolveAgentProfile(options.agentProfileId || options.agentProfile), options.uiLanguage);
    const usageMode = resolveUsageMode(options.usageModeId || options.usageMode);
    const profileSeparator = languageId(options.uiLanguage) === 'zh' ? '：' : ': ';
    return [
        `${profile.label}${profileSeparator}${profile.installHint}`,
        `Use case: ${usageMode.label}. ${usageMode.installHint}`,
        `MCP server key: ${vaultIdentity.serverKey}`,
        vaultIdentity.vaultPath
            ? `This entry is bound to vault "${vaultIdentity.vaultName}" at ${normalizeMcpPath(vaultIdentity.vaultPath)}.`
            : 'The current Obsidian adapter did not expose a vault path; export after opening the target vault.',
        'For multiple vaults, repeat this setup from each vault and keep each generated MCP server entry.',
        'Understory does not scan all Obsidian vaults or write external agent config files automatically.',
    ].join('\n');
}

function createUnderstorySkill(options = {}) {
    const vaultIdentity = resolveVaultIdentity(options);
    const profile = localizeAgentProfile(resolveAgentProfile(options.agentProfileId || options.agentProfile), options.uiLanguage);
    const usageMode = resolveUsageMode(options.usageModeId || options.usageMode);
    const vaultLine = vaultIdentity.vaultPath
        ? `- Vault path: \`${normalizeMcpPath(vaultIdentity.vaultPath)}\`. Treat this path as local and private.`
        : '- The vault path is supplied by the MCP server configuration. Treat it as local and private.';
    const knowledgeMapWorkflow = [
        '## Business Knowledge Map Workflow',
        '',
        '- When the user asks for research, positioning, product strategy, competitive context, architecture context, related notes, or reusable vault knowledge, turn Understory results into a business-oriented knowledge map instead of a raw search-results list.',
        '- First restate the business question, target reader, and intended output location or format. If any part is unclear, make the smallest reasonable assumption and name it.',
        '- Design 3-5 focused searches that cover different angles of the problem, including synonyms or bilingual terms when useful.',
        '- Use `understory_search` for each angle, then use `understory_get_context` or `understory_get_note_brief` for the strongest candidate notes.',
        '- Deduplicate notes and group them by business module, mechanism, decision area, or project concern rather than by query order.',
        '- For each important note, explain why it matters, what mechanism or product meaning it contributes, and whether it is required reading, optional background, needs verification, or exposes a research gap.',
        '- Always include knowledge gaps, recommended next actions, and a role-based reading path when the task is broader than a simple lookup.',
        '',
        '## Knowledge Map Quality Bar',
        '',
        '- Do not only say that a note matched a keyword.',
        '- Do not paste together raw MCP results.',
        '- Do not invent vault facts beyond returned snippets, relation metadata, or explicitly read context.',
        '- If the user asks for a durable markdown deliverable, use a structure compatible with `templates/knowledge-map.md` from the bundled Understory engine when available.',
    ];
    const behavior = usageMode.id === 'query'
        ? [
            'Use this skill when the user explicitly asks to query, search, cite, summarize, or inspect this Obsidian vault.',
            '',
            '## Query-only Behavior',
            '',
            '- Call the Understory MCP server before reading the filesystem directly for vault search or retrieval tasks.',
            '- Start with `understory_status` to confirm the vault and local engine state.',
            '- Prefer `understory_search`, `understory_get_context`, or `understory_get_note_brief` for scoped context packages.',
            '- Use `understory_graph_summary` for a vault overview and `understory_get_relations` when a note path is known.',
            '- Do not call Understory automatically at task start unless the user asks to use Understory, search Obsidian, check this vault, or cite vault context.',
            '- Do not scan the entire vault by default.',
            '- Do not return full note bodies unless the user explicitly asks and the result is necessary.',
            '',
            '## Write Safety',
            '',
            '- Treat Query-only mode as read-only.',
            '- Do not create, update, accept, reject, insert, refresh, write back, or maintain notes, relations, or memory from this Skill.',
            '- Never send vault text, API keys, prompts, embeddings, logs, or webhook URLs to Bondie Labs.',
        ]
        : [
            'Use this skill when the agent should use this Obsidian vault as active local context and a long-term memory layer for projects, preferences, notes, knowledge relationships, claims, conflicts, or related-note discovery.',
            '',
            '## Memory Model Behavior',
            '',
            '- Call the Understory MCP server before reading the filesystem directly.',
            '- For complex, ongoing, or project-specific tasks that may relate to this vault, retrieve relevant Understory context early even if the user did not explicitly say "search Obsidian".',
            '- Start with `understory_status` to confirm the vault and local engine state.',
            '- Prefer `understory_search`, `understory_get_context`, or `understory_get_note_brief` for scoped context packages before forming a plan.',
            '- Use `understory_graph_summary` for a vault overview and `understory_get_relations` when a note path is known.',
            '- Do not scan the entire vault by default.',
            '- Do not return full note bodies unless the user explicitly asks and the result is necessary.',
            '- At the end of substantial work, identify durable memory, relation, decision, or project-state updates that may be worth preserving.',
            '',
            '## Memory Write Safety',
            '',
            '- Default to read-only context gathering while reasoning.',
            '- Before calling write tools such as accept, reject, insert, refresh, or writeback, explain the planned local change and ask the user to confirm.',
            '- If a memory or relation update is useful but no safe write tool is available, present a concise suggested note update for user approval.',
            '- Never send vault text, API keys, prompts, embeddings, logs, or webhook URLs to Bondie Labs.',
        ];
    return [
        '# Understory Skill',
        '',
        `Use case: ${usageMode.label}.`,
        '',
        ...behavior,
        '',
        ...knowledgeMapWorkflow,
        '',
        '## Fallback',
        '',
        '- If MCP is unavailable, report the connection problem and tell the user to open Obsidian Settings -> Understory -> AI agents.',
        '- Use direct file reads only after MCP is unavailable or insufficient, and keep reads scoped to the user request.',
        '',
        '## Local Context',
        '',
        `- Vault name: ${vaultIdentity.vaultName}`,
        vaultLine,
        `- MCP server key: \`${vaultIdentity.serverKey}\`.`,
        `- Usage mode: ${usageMode.label}.`,
        `- Target agent profile: ${profile.label}.`,
        '- This Skill is only for this vault.',
        "- If the user asks about another vault, use that vault's matching Understory MCP server.",
        '- Do not pass another `vaultPath` to this server unless the user explicitly asks for advanced troubleshooting.',
        '- The MCP transport is stdio; Understory does not open an HTTP port for agent access.',
        '',
    ].join('\n');
}

function createAgentDiagnostics(options = {}, settings = {}) {
    const vaultIdentity = resolveVaultIdentity(options);
    const lines = [
        'Understory Agent Access diagnostics',
        `Plugin version: ${options.pluginVersion || 'unknown'}`,
        `Vault name: ${vaultIdentity.vaultName || 'not available'}`,
        `Vault path: ${vaultIdentity.vaultPath || 'not available'}`,
        `MCP server key: ${vaultIdentity.serverKey || 'not available'}`,
        `MCP server path: ${options.mcpServerPath || 'not exported yet'}`,
        `Skill path: ${options.skillPath || 'not exported yet'}`,
        `Engine folder: ${options.engineDir || 'not set'}`,
        `Python path: ${options.pythonPath || 'python'}`,
        `Network mode: ${options.networkMode || 'local'}`,
        'Transport: MCP stdio, no HTTP port',
    ];
    return redactSensitiveText(lines.join('\n'), settings);
}

function createAgentSetupPack(options = {}, settings = {}) {
    const vaultIdentity = resolveVaultIdentity(options);
    const uiLanguage = options.uiLanguage || settings.uiLanguage || 'en';
    const agentProfile = localizeAgentProfile(resolveAgentProfile(options.agentProfileId || options.agentProfile), uiLanguage);
    const usageMode = resolveUsageMode(options.usageModeId || options.usageMode);
    const setupOptions = {
        ...options,
        agentProfileId: agentProfile.id,
        usageModeId: usageMode.id,
        uiLanguage,
        vaultIdentity,
    };
    const mcpConfigText = formatMcpConfig(setupOptions);
    const skillText = createUnderstorySkill(setupOptions);
    const installNotesText = createAgentInstallNotes(setupOptions);
    const diagnosticsText = createAgentDiagnostics(setupOptions, settings);
    const setupPackText = [
        '# Understory Agent Setup Pack',
        '',
        '## Vault identity',
        '',
        `- Vault name: ${vaultIdentity.vaultName}`,
        `- Vault path: ${vaultIdentity.vaultPath ? normalizeMcpPath(vaultIdentity.vaultPath) : 'not available'}`,
        `- MCP server key: ${vaultIdentity.serverKey}`,
        `- Use case: ${usageMode.label}`,
        `- Agent profile: ${agentProfile.label}`,
        '',
        '## Install notes',
        '',
        installNotesText,
        '',
        '## MCP config',
        '',
        '```json',
        mcpConfigText,
        '```',
        '',
        '## Understory Skill',
        '',
        skillText,
        '',
    ].join('\n');

    return {
        agentProfile,
        diagnosticsText,
        installNotesText,
        mcpConfigText,
        setupPackText,
        skillText,
        usageMode,
        vaultIdentity,
    };
}

function stripHashbang(source) {
    return String(source || '').replace(/^#!.*\r?\n/, '');
}

function loadBundledSources() {
    try {
        return require('./agentAccessBundledSources');
    } catch (error) {
        // Source-tree fallback for tests and development builds.
    }

    if (typeof __dirname === 'undefined') return {};
    try {
        const rootDir = path.resolve(__dirname, '..');
        return {
            agentApiSource: fs.readFileSync(path.join(rootDir, 'src', 'agentApi.js'), 'utf8'),
            safetySource: fs.readFileSync(path.join(rootDir, 'src', 'safety.js'), 'utf8'),
            mcpServerSource: fs.readFileSync(path.join(rootDir, 'scripts', 'understory-mcp-server.js'), 'utf8'),
        };
    } catch (error) {
        return {};
    }
}

function moduleSourceBlock(source) {
    return stripHashbang(source || 'throw new Error("Understory bundled source is unavailable.");');
}

function createStandaloneMcpServerSource() {
    const sources = loadBundledSources();
    const safetySource = moduleSourceBlock(sources.safetySource);
    const agentApiSource = moduleSourceBlock(sources.agentApiSource);
    const mcpServerSource = moduleSourceBlock(sources.mcpServerSource);

    return `#!/usr/bin/env node
// Generated by Understory. This standalone MCP server is local-only and uses stdio.
(function() {
const __rootRequire = typeof require === 'function' ? require : null;
const __modules = {
  './safety': function(module, exports, require) {
${safetySource}
  },
  './agentApi': function(module, exports, require) {
${agentApiSource}
  },
  './understory-mcp-server': function(module, exports, require) {
${mcpServerSource}
  }
};
const __cache = {};
function __normalize(id) {
  if (id.endsWith('.js')) id = id.slice(0, -3);
  id = id.replace(/\\\\/g, '/');
  if (id === '../src/agentApi') return './agentApi';
  if (id === '../src/safety') return './safety';
  if (id === './safety') return './safety';
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
const server = __require('./understory-mcp-server');
server.startServer(process.argv.slice(2), process.stdin, process.stdout, process.stderr);
})();
`;
}

async function writeAgentAccessFile(filePath, content) {
    if (!filePath) throw new Error('Missing output path.');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
    return filePath;
}

function checkAgentAccessStatus(options = {}) {
    const pathExists = (candidate) => !!candidate && fs.existsSync(candidate);
    const checks = [
        { key: 'vaultPath', ok: pathExists(options.vaultPath), label: 'Vault path' },
        { key: 'engineDir', ok: pathExists(options.engineDir), label: 'Engine folder' },
        { key: 'pythonPath', ok: !!(options.pythonPath || 'python'), label: 'Python path' },
        { key: 'mcpServerPath', ok: pathExists(options.mcpServerPath), label: 'MCP server export' },
    ];
    return {
        ok: checks.every((check) => check.ok),
        checks,
    };
}

module.exports = {
    AGENT_DIR,
    AGENT_PROFILES,
    MCP_SERVER_FILENAME,
    SKILL_FILENAME,
    USAGE_MODES,
    agentProfilesForLanguage,
    checkAgentAccessStatus,
    createAgentAccessPaths,
    createAgentDiagnostics,
    createAgentInstallNotes,
    createMcpConfig,
    createAgentSetupPack,
    createServerKey,
    createStandaloneMcpServerSource,
    createUnderstorySkill,
    createVaultIdentity,
    formatMcpConfig,
    getVaultBasePath,
    normalizeMcpPath,
    resolveAgentProfile,
    resolveUsageMode,
    slugifyVaultName,
    shortHash,
    writeAgentAccessFile,
};
