const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    AGENT_PROFILES,
    USAGE_MODES,
    agentProfilesForLanguage,
    checkAgentAccessStatus,
    createAgentAccessPaths,
    createAgentDiagnostics,
    createAgentSetupPack,
    createMcpConfig,
    createStandaloneMcpServerSource,
    createUnderstorySkill,
    createVaultIdentity,
    formatMcpConfig,
} = require('../src/agentAccess');

test('agent access paths live inside vault .understory agent folder', () => {
    const paths = createAgentAccessPaths('C:\\Vault');

    assert.equal(paths.skillVaultPath, '.understory/agent/understory-skill.md');
    assert.match(paths.mcpServerPath, /understory-mcp-server\.js$/);
    assert.match(paths.skillPath, /understory-skill\.md$/);
});

test('MCP config points to exported standalone server without secrets', () => {
    const config = createMcpConfig({
        vaultPath: 'C:\\Vault',
        engineDir: 'C:\\Engine',
        pythonPath: 'C:\\Python\\python.exe',
        mcpServerPath: 'C:\\Vault\\.understory\\agent\\understory-mcp-server.js',
    });
    const text = formatMcpConfig({
        vaultPath: 'C:\\Vault',
        engineDir: 'C:\\Engine',
        pythonPath: 'C:\\Python\\python.exe',
        mcpServerPath: 'C:\\Vault\\.understory\\agent\\understory-mcp-server.js',
    });

    assert.equal(config.command, 'node');
    assert.deepEqual(config.args.slice(0, 3), [
        'C:/Vault/.understory/agent/understory-mcp-server.js',
        '--vault',
        'C:/Vault',
    ]);
    assert.match(text, /"mcpServers"/);
    assert.match(text, /understory-mcp-server\.js/);
    assert.doesNotMatch(text, /sk-[a-z0-9]/i);
});

test('vault identity generates stable vault-specific MCP server keys', () => {
    const work = createVaultIdentity('C:\\Vaults\\Work Notes');
    const research = createVaultIdentity('C:\\Vaults\\Research');
    const duplicate = createVaultIdentity('D:\\Other\\Work Notes', {
        existingServerKeys: [work.serverKey],
    });

    assert.equal(work.vaultName, 'Work Notes');
    assert.equal(work.vaultSlug, 'work-notes');
    assert.equal(work.serverKey, 'understory-work-notes');
    assert.equal(research.serverKey, 'understory-research');
    assert.notEqual(work.serverKey, research.serverKey);
    assert.match(duplicate.serverKey, /^understory-work-notes-[a-f0-9]{6}$/);
});

test('vault identity keeps non-ascii vault names MCP-safe', () => {
    const identity = createVaultIdentity('C:\\Vaults\\研究 笔记!');

    assert.equal(identity.vaultName, '研究 笔记!');
    assert.match(identity.serverKey, /^understory-vault-[a-f0-9]{8}$/);
    assert.match(identity.serverKey, /^[a-z0-9_-]+$/);
});

test('MCP config uses vault-specific server key instead of a global key', () => {
    const text = formatMcpConfig({
        vaultPath: 'C:\\Vaults\\Work Notes',
        engineDir: 'C:\\Engine',
        pythonPath: 'python',
        mcpServerPath: 'C:\\Vaults\\Work Notes\\.understory\\agent\\understory-mcp-server.js',
    });
    const parsed = JSON.parse(text);

    assert.ok(parsed.mcpServers['understory-work-notes']);
    assert.equal(parsed.mcpServers.understory, undefined);
});

test('Understory Skill changes agent behavior toward MCP first', () => {
    const skill = createUnderstorySkill({ vaultPath: 'C:\\Vaults\\Work Notes' });

    assert.match(skill, /Call the Understory MCP server before reading the filesystem directly/);
    assert.match(skill, /Use case: Agent memory model/);
    assert.match(skill, /active local context and a long-term memory layer/);
    assert.match(skill, /retrieve relevant Understory context early even if the user did not explicitly say "search Obsidian"/);
    assert.match(skill, /durable memory, relation, decision, or project-state updates/);
    assert.match(skill, /business-oriented knowledge map/);
    assert.match(skill, /Design 3-5 focused searches/);
    assert.match(skill, /required reading, optional background, needs verification, or exposes a research gap/);
    assert.match(skill, /role-based reading path/);
    assert.match(skill, /Do not scan the entire vault by default/);
    assert.match(skill, /Before calling write tools/);
    assert.match(skill, /MCP is unavailable/);
    assert.match(skill, /Vault name: Work Notes/);
    assert.match(skill, /MCP server key: `understory-work-notes`/);
    assert.match(skill, /This Skill is only for this vault/);
    assert.match(skill, /matching Understory MCP server/);
    assert.match(skill, /Do not pass another `vaultPath`/);
});

test('Understory Skill supports query-only and memory usage modes', () => {
    const querySkill = createUnderstorySkill({
        usageModeId: 'query',
        vaultPath: 'C:\\Vaults\\Work Notes',
    });
    const memorySkill = createUnderstorySkill({
        usageModeId: 'memory',
        vaultPath: 'C:\\Vaults\\Work Notes',
    });

    assert.match(querySkill, /Use case: Query-only/);
    assert.match(querySkill, /when the user explicitly asks to query, search, cite, summarize, or inspect/);
    assert.match(querySkill, /business-oriented knowledge map/);
    assert.match(querySkill, /Treat Query-only mode as read-only/);
    assert.match(querySkill, /Do not create, update, accept, reject, insert, refresh, write back, or maintain/);
    assert.doesNotMatch(querySkill, /retrieve relevant Understory context early/);

    assert.match(memorySkill, /Use case: Agent memory model/);
    assert.match(memorySkill, /active local context and a long-term memory layer/);
    assert.match(memorySkill, /retrieve relevant Understory context early even if the user did not explicitly say "search Obsidian"/);
    assert.match(memorySkill, /At the end of substantial work, identify durable memory/);
    assert.doesNotMatch(memorySkill, /Do not call Understory automatically at task start/);
});

test('setup pack generates install notes for each agent profile', () => {
    for (const profileId of Object.keys(AGENT_PROFILES)) {
        const pack = createAgentSetupPack({
            agentProfileId: profileId,
            vaultPath: 'C:\\Vaults\\Work Notes',
            engineDir: 'C:\\Engine',
            pythonPath: 'python',
            mcpServerPath: 'C:\\Vaults\\Work Notes\\.understory\\agent\\understory-mcp-server.js',
        });

        assert.equal(pack.agentProfile.id, profileId);
        assert.equal(pack.usageMode.id, 'memory');
        assert.match(pack.installNotesText, new RegExp(AGENT_PROFILES[profileId].label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(pack.installNotesText, /Use case: Agent memory model/);
        assert.match(pack.setupPackText, /understory-work-notes/);
        assert.match(pack.setupPackText, /Use case: Agent memory model/);
        assert.match(pack.setupPackText, /This Skill is only for this vault/);
        assert.doesNotMatch(pack.setupPackText, /sk-[a-z0-9]/i);
        assert.doesNotMatch(pack.setupPackText, /https:\/\/hooks\.slack/i);
    }
});

test('setup pack localizes agent profile labels and install notes', () => {
    const profiles = agentProfilesForLanguage('zh');
    assert.equal(profiles.generic.label, '通用 MCP');

    const pack = createAgentSetupPack({
        agentProfileId: 'generic',
        vaultPath: 'C:\\Vaults\\Work Notes',
        engineDir: 'C:\\Engine',
        pythonPath: 'python',
        mcpServerPath: 'C:\\Vaults\\Work Notes\\.understory\\agent\\understory-mcp-server.js',
    }, { uiLanguage: 'zh' });

    assert.equal(pack.agentProfile.label, '通用 MCP');
    assert.match(pack.installNotesText, /通用 MCP：把这段 JSON 粘贴到任何支持 stdio 的 MCP 客户端/);
    assert.match(pack.setupPackText, /Agent profile: 通用 MCP/);
    assert.doesNotMatch(pack.installNotesText, /Generic MCP: Paste this JSON/);
});

test('setup pack generates distinct usage-mode skill variants', () => {
    for (const modeId of Object.keys(USAGE_MODES)) {
        const pack = createAgentSetupPack({
            usageModeId: modeId,
            vaultPath: 'C:\\Vaults\\Work Notes',
            engineDir: 'C:\\Engine',
            pythonPath: 'python',
            mcpServerPath: 'C:\\Vaults\\Work Notes\\.understory\\agent\\understory-mcp-server.js',
        });

        assert.equal(pack.usageMode.id, modeId);
        assert.match(pack.setupPackText, new RegExp(USAGE_MODES[modeId].label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('diagnostics redact configured secrets', () => {
    const diagnostics = createAgentDiagnostics({
        vaultPath: 'C:\\Vault',
        mcpServerPath: 'C:\\Vault\\.understory\\agent\\understory-mcp-server.js',
        engineDir: 'C:\\Engine',
        pythonPath: 'python',
        networkMode: 'local',
        pluginVersion: '1.7.2',
    }, {
        embeddingApiKey: 'sk-secretsecretsecretsecret',
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRETSECRET',
    });

    assert.match(diagnostics, /Agent Access diagnostics/i);
    assert.doesNotMatch(diagnostics, /sk-secretsecret/);
    assert.doesNotMatch(diagnostics, /hooks\.slack\.com/);
});

test('standalone MCP server bundle embeds current server sources', () => {
    const source = createStandaloneMcpServerSource();

    assert.match(source, /^#!\/usr\/bin\/env node/);
    assert.match(source, /understory_status/);
    assert.match(source, /server\.startServer/);
    assert.doesNotMatch(source.slice(2), /#!\/usr\/bin\/env node/);
});

test('agent access readiness checks actual local paths', async (t) => {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-agent-access-'));
    const engineDir = path.join(vaultPath, 'engine-missing');
    const mcpServerPath = path.join(vaultPath, '.understory', 'agent', 'understory-mcp-server.js');
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });

    let status = checkAgentAccessStatus({
        vaultPath,
        engineDir,
        mcpServerPath,
        pythonPath: 'python',
    });
    assert.equal(status.ok, false);
    assert.equal(status.checks.find((check) => check.key === 'engineDir').ok, false);

    await fs.promises.mkdir(engineDir, { recursive: true });
    await fs.promises.mkdir(path.dirname(mcpServerPath), { recursive: true });
    await fs.promises.writeFile(mcpServerPath, '#!/usr/bin/env node\n', 'utf8');

    status = checkAgentAccessStatus({
        vaultPath,
        engineDir,
        mcpServerPath,
        pythonPath: 'python',
    });
    assert.equal(status.ok, true);
});
