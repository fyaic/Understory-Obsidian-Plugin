/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const fs = require('fs');
const path = require('path');
const { redactSensitiveText } = require('./safety');

const CHECK_GROUPS = ['paths', 'scripts', 'dependencies', 'permissions', 'vault'];

const REQUIRED_ENGINE_SCRIPTS = [
    { id: 'engine.api_missing', group: 'paths', label: 'api.py', pathParts: ['api.py'], severity: 'error' },
    { id: 'engine.deploy_missing', group: 'scripts', label: 'scripts/deploy_graphify.py', pathParts: ['scripts', 'deploy_graphify.py'], severity: 'error' },
    { id: 'engine.vault_ops_missing', group: 'scripts', label: 'scripts/vault_ops.py', pathParts: ['scripts', 'vault_ops.py'], severity: 'warning' },
    { id: 'engine.index_daemon_missing', group: 'scripts', label: 'scripts/index_daemon.py', pathParts: ['scripts', 'index_daemon.py'], severity: 'warning' },
    { id: 'engine.template_ingest_missing', group: 'scripts', label: 'graphify-template/scripts/ingest_principles.py', pathParts: ['graphify-template', 'scripts', 'ingest_principles.py'], severity: 'warning' },
    { id: 'engine.template_lint_missing', group: 'scripts', label: 'graphify-template/scripts/lint.py', pathParts: ['graphify-template', 'scripts', 'lint.py'], severity: 'warning' },
    { id: 'engine.template_graph_missing', group: 'scripts', label: 'graphify-template/scripts/graph_analyzer.py', pathParts: ['graphify-template', 'scripts', 'graph_analyzer.py'], severity: 'warning' },
    { id: 'engine.template_index_missing', group: 'scripts', label: 'graphify-template/scripts/index_generator.py', pathParts: ['graphify-template', 'scripts', 'index_generator.py'], severity: 'warning' },
    { id: 'engine.template_notify_missing', group: 'scripts', label: 'graphify-template/scripts/notification_manager.py', pathParts: ['graphify-template', 'scripts', 'notification_manager.py'], severity: 'warning' },
    { id: 'engine.template_common_missing', group: 'scripts', label: 'graphify-template/scripts/graphify_common.py', pathParts: ['graphify-template', 'scripts', 'graphify_common.py'], severity: 'warning' },
];

const REQUIRED_PYTHON_MODULES = [
    { id: 'engine.dep_requests_missing', packageName: 'requests', importName: 'requests', required: true },
    { id: 'engine.dep_dotenv_missing', packageName: 'python-dotenv', importName: 'dotenv', required: true },
    { id: 'engine.dep_yaml_missing', packageName: 'PyYAML', importName: 'yaml', required: true },
];

function emptyChecks() {
    return CHECK_GROUPS.reduce((checks, group) => {
        checks[group] = [];
        return checks;
    }, {});
}

function createEngineHealthIssue(input = {}) {
    const severity = input.severity === 'warning' || input.severity === 'info' ? input.severity : 'error';
    return {
        id: input.id || 'engine.unknown_issue',
        severity,
        group: input.group || 'paths',
        title: input.title || input.id || 'Engine issue',
        detail: input.detail || '',
        fix: input.fix || '',
        command: input.command || '',
        path: input.path || '',
    };
}

function createEngineCheck(input = {}) {
    return {
        id: input.id || 'engine.check',
        label: input.label || input.id || 'Check',
        status: input.status || 'unknown',
        severity: input.severity || 'info',
        detail: input.detail || '',
        path: input.path || '',
    };
}

function addCheck(checks, group, check) {
    const targetGroup = CHECK_GROUPS.includes(group) ? group : 'paths';
    checks[targetGroup].push(createEngineCheck(check));
}

function statusFromIssues(issues) {
    if (issues.some((issue) => issue.severity === 'error')) return 'error';
    if (issues.some((issue) => issue.severity === 'warning')) return 'warning';
    return 'ready';
}

function summarizeIssue(issue) {
    if (typeof issue === 'string') return issue;
    return issue.title || issue.detail || issue.id || 'Engine issue';
}

function buildEngineDiagnosticText(health = {}, settings = {}) {
    const status = health.status || (health.ok ? 'ready' : 'error');
    const lines = [
        'Understory engine diagnostics',
        `Checked at: ${health.checkedAt ? new Date(health.checkedAt).toISOString() : 'not checked'}`,
        `Status: ${status}`,
        `Plugin version: ${health.pluginVersion || 'unknown'}`,
        `Engine dir: ${health.engineDir || '(not set)'}`,
        `Engine version: ${health.engineVersion || 'unknown'}`,
        `Engine commit: ${health.engineCommit || 'unknown'}`,
        `Python path: ${health.pythonPath || 'python'}`,
        `Python version: ${health.pythonVersion || 'unknown'}`,
        `Vault .understory: ${health.vaultUnderstoryPath || 'not checked'}`,
    ];

    const issues = Array.isArray(health.issues) ? health.issues : [];
    if (issues.length) {
        lines.push('', 'Issues:');
        for (const issue of issues) {
            if (typeof issue === 'string') {
                lines.push(`- ${issue}`);
            } else {
                const prefix = `[${issue.severity || 'info'}] ${issue.id || 'engine.issue'}`;
                lines.push(`- ${prefix}: ${summarizeIssue(issue)}`);
                if (issue.detail) lines.push(`  Detail: ${issue.detail}`);
                if (issue.fix) lines.push(`  Fix: ${issue.fix}`);
                if (issue.command) lines.push(`  Command: ${issue.command}`);
            }
        }
    } else {
        lines.push('', 'Issues: none');
    }

    return redactSensitiveText(lines.join('\n'), settings);
}

function readFileIfExists(filename, fsImpl = fs) {
    try {
        if (!filename || !fsImpl.existsSync(filename)) return '';
        return String(fsImpl.readFileSync(filename, 'utf8') || '').trim();
    } catch {
        return '';
    }
}

function resolveGitDir(engineDir, fsImpl = fs, pathImpl = path) {
    const gitPath = pathImpl.join(engineDir, '.git');
    try {
        if (!fsImpl.existsSync(gitPath)) return '';
        const stat = fsImpl.statSync(gitPath);
        if (stat.isDirectory()) return gitPath;
        const pointer = readFileIfExists(gitPath, fsImpl);
        const match = pointer.match(/^gitdir:\s*(.+)$/i);
        if (!match) return '';
        return pathImpl.resolve(engineDir, match[1].trim());
    } catch {
        return '';
    }
}

function readGitCommit(engineDir, fsImpl = fs, pathImpl = path) {
    const gitDir = resolveGitDir(engineDir, fsImpl, pathImpl);
    if (!gitDir) return 'unknown';
    const head = readFileIfExists(pathImpl.join(gitDir, 'HEAD'), fsImpl);
    if (!head) return 'unknown';
    if (/^[a-f0-9]{7,40}$/i.test(head)) return head.slice(0, 12);
    const refMatch = head.match(/^ref:\s*(.+)$/i);
    if (!refMatch) return 'unknown';
    const ref = readFileIfExists(pathImpl.join(gitDir, refMatch[1].trim()), fsImpl);
    return /^[a-f0-9]{7,40}$/i.test(ref) ? ref.slice(0, 12) : 'unknown';
}

function readEngineVersion(engineDir, options = {}) {
    const fsImpl = options.fs || fs;
    const pathImpl = options.path || path;
    if (!engineDir) return { version: 'unknown', commit: 'unknown' };

    let version = readFileIfExists(pathImpl.join(engineDir, 'VERSION'), fsImpl)
        || readFileIfExists(pathImpl.join(engineDir, 'version.txt'), fsImpl);
    if (!version) {
        const pyproject = readFileIfExists(pathImpl.join(engineDir, 'pyproject.toml'), fsImpl);
        const match = pyproject.match(/^version\s*=\s*["']([^"']+)["']/m);
        version = match ? match[1] : '';
    }

    return {
        version: version || 'unknown',
        commit: readGitCommit(engineDir, fsImpl, pathImpl),
    };
}

function checkPathAccess(targetPath, mode = 'read', fsImpl = fs) {
    if (!targetPath) {
        return { ok: false, exists: false, mode, errorCode: 'EMPTY_PATH', errorMessage: 'Path is empty' };
    }
    const wantsWrite = String(mode).includes('write');
    const wantsRead = String(mode).includes('read') || !wantsWrite;
    let accessMode = 0;
    if (wantsRead) accessMode |= fsImpl.constants.R_OK;
    if (wantsWrite) accessMode |= fsImpl.constants.W_OK;

    try {
        if (!fsImpl.existsSync(targetPath)) {
            return { ok: false, exists: false, mode, errorCode: 'ENOENT', errorMessage: 'Path does not exist' };
        }
        fsImpl.accessSync(targetPath, accessMode);
        return { ok: true, exists: true, mode, errorCode: '', errorMessage: '' };
    } catch (error) {
        return {
            ok: false,
            exists: true,
            mode,
            errorCode: error && error.code ? error.code : 'ACCESS_ERROR',
            errorMessage: error && error.message ? error.message : 'Access check failed',
        };
    }
}

module.exports = {
    CHECK_GROUPS,
    REQUIRED_ENGINE_SCRIPTS,
    REQUIRED_PYTHON_MODULES,
    addCheck,
    buildEngineDiagnosticText,
    checkPathAccess,
    createEngineCheck,
    createEngineHealthIssue,
    emptyChecks,
    readEngineVersion,
    statusFromIssues,
    summarizeIssue,
};

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
