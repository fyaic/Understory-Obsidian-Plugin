const { Notice, TFile } = require('obsidian');
const { GraphifyContentModal, MAX_LOG_ENTRIES, MAX_PROCESS_OUTPUT_BYTES } = require('./utils');
const { t } = require('./i18n');
const {
    REQUIRED_ENGINE_SCRIPTS,
    REQUIRED_PYTHON_MODULES,
    addCheck,
    buildEngineDiagnosticText,
    checkPathAccess,
    createEngineHealthIssue,
    emptyChecks,
    readEngineVersion,
    statusFromIssues,
    summarizeIssue,
} = require('./engineHealth');
const {
    extractProcessJsonMessage,
    normalizeLogEntry,
    recordBackgroundError,
    redactSensitiveText,
    safeErrorDetail,
    safeNetworkMode,
} = require('./safety');

const MANAGED_ENV_KEYS = [
    'UNDERSTORY_EMBEDDING_PROVIDER',
    'UNDERSTORY_LLM_PROVIDER',
    'UNDERSTORY_EMBEDDING_BASE_URL',
    'UNDERSTORY_EMBEDDING_MODEL',
    'UNDERSTORY_EMBEDDING_DIMENSIONS',
    'UNDERSTORY_EMBEDDING_API_KEY',
    'UNDERSTORY_LLM_BASE_URL',
    'UNDERSTORY_LLM_MODEL',
    'UNDERSTORY_LLM_API_KEY',
    'UNDERSTORY_HOSTED_API_BASE_URL',
    'UNDERSTORY_HOSTED_ACCESS_TOKEN',
    'UNDERSTORY_WEBHOOK_ENABLED',
];

class GraphifyRuntimeMethods {
    _openOrphansView() {
        const data = this._readConflicts();
        const orphans = ((data && data.issues) || []).filter(i => i.status === 'open' && i.type === 'orphan_page');
        if (orphans.length === 0) {
            new Notice(t(this, 'orphans_none'), 4000);
            return;
        }
        new GraphifyContentModal(this.app, this, t(this, 'orphans_title', { count: orphans.length }), (wrap, modal) => {
            wrap.createEl('p', {
                text: t(this, 'orphans_desc'),
                cls: 'setting-item-description'
            });
            const list = wrap.createEl('div');
            for (const it of orphans) {
                const row = list.createEl('div', { cls: 'understory-orphan-row' });
                this._appendNoteLink(row, it.doc, modal);
            }
        }).open();
    }

    _engineDir() {
        return String(this.settings?.graphifyDir || '').trim();
    }

    _pythonExe() {
        return String(this.settings?.pythonPath || 'python').trim() || 'python';
    }

    _joinPath(...parts) {
        return parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
    }

    _enginePath(...parts) {
        return this._joinPath(this._engineDir(), ...parts);
    }

    _pythonEnv(extra = {}) {
        const vaultBase = this._vaultBasePath ? this._vaultBasePath() : null;
        const networkMode = safeNetworkMode(this.settings?.networkMode, 'hosted');
        const isHosted = networkMode === 'hosted';
        const webhookEnabled = !isHosted && networkMode !== 'local'
            && !!this.settings?.webhookEnabled
            && !!String(this.settings?.webhookUrl || '').trim();
        const env = {
            ...process.env,
            UNDERSTORY_ENGINE_DIR: this._engineDir(),
            OBSIDIAN_VAULT_PATH: vaultBase || process.env.OBSIDIAN_VAULT_PATH || '',
            UNDERSTORY_NETWORK_MODE: networkMode,
            UNDERSTORY_UI_LANGUAGE: this.settings?.uiLanguage || 'en',
            UNDERSTORY_WEBHOOK_ENABLED: webhookEnabled ? '1' : '0',
            PYTHONIOENCODING: 'utf-8',
            ...extra,
        };
        for (const key of MANAGED_ENV_KEYS) delete env[key];
        env.UNDERSTORY_WEBHOOK_ENABLED = webhookEnabled ? '1' : '0';
        const setIfPresent = (key, value) => {
            const text = String(value || '').trim();
            if (text) env[key] = text;
        };

        if (isHosted) {
            const config = this.settings?.hostedRuntimeConfig || {};
            const features = config.features || {};
            const embedding = features.embedding || {};
            const reasoning = features.reasoning || {};
            env.UNDERSTORY_EMBEDDING_PROVIDER = 'hosted';
            env.UNDERSTORY_LLM_PROVIDER = 'hosted';
            setIfPresent('UNDERSTORY_HOSTED_API_BASE_URL', this.settings?.hostedServerUrl || config.public_api_base_url);
            setIfPresent('UNDERSTORY_HOSTED_ACCESS_TOKEN', this.settings?.hostedAccessToken);
            setIfPresent('UNDERSTORY_EMBEDDING_MODEL', embedding.model || this.settings?.embeddingModel);
            setIfPresent('UNDERSTORY_LLM_MODEL', reasoning.model || this.settings?.llmModel);
            return env;
        }

        if (networkMode === 'embedding' || networkMode === 'full') {
            setIfPresent('UNDERSTORY_EMBEDDING_PROVIDER', this.settings?.embeddingProvider);
            setIfPresent('UNDERSTORY_EMBEDDING_BASE_URL', this.settings?.embeddingBaseUrl);
            setIfPresent('UNDERSTORY_EMBEDDING_MODEL', this.settings?.embeddingModel);
            setIfPresent('UNDERSTORY_EMBEDDING_DIMENSIONS', this.settings?.embeddingDimensions);
            setIfPresent('UNDERSTORY_EMBEDDING_API_KEY', this.settings?.embeddingApiKey);
        }
        if (networkMode === 'full') {
            setIfPresent('UNDERSTORY_LLM_PROVIDER', this.settings?.llmProvider);
            setIfPresent('UNDERSTORY_LLM_BASE_URL', this.settings?.llmBaseUrl);
            setIfPresent('UNDERSTORY_LLM_MODEL', this.settings?.llmModel);
            setIfPresent('UNDERSTORY_LLM_API_KEY', this.settings?.llmApiKey);
        }
        return env;
    }

    _engineHealthKey() {
        return `${this._engineDir()}|${this._pythonExe()}`;
    }

    _checkPythonVersion(timeoutMs = 5000) {
        return this._runPythonProbe(['--version'], timeoutMs);
    }

    _checkPythonModules(timeoutMs = 5000) {
        return this._runPythonProbe(['-c', 'import requests, dotenv, yaml; print("dependencies ok")'], timeoutMs);
    }

    _checkPythonModule(moduleName, timeoutMs = 5000) {
        return this._runPythonProbe(['-c', `import ${moduleName}; print("${moduleName} ok")`], timeoutMs);
    }

    _runPythonProbe(args, timeoutMs = 5000) {
        const { spawn } = require('child_process');
        const pythonExe = this._pythonExe();
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonExe, args, {
                env: this._pythonEnv(),
                windowsHide: true,
            });
            let output = '';
            let timer = window.setTimeout(() => {
                try { proc.kill(); } catch (error) { /* ignore */ }
                reject(new Error(t(this, 'engine_python_timeout')));
            }, timeoutMs);
            proc.stdout?.on('data', (data) => { output += data.toString(); });
            proc.stderr?.on('data', (data) => { output += data.toString(); });
            proc.on('error', (error) => {
                if (timer) window.clearTimeout(timer);
                timer = null;
                reject(error);
            });
            proc.on('close', (code) => {
                if (timer) window.clearTimeout(timer);
                timer = null;
                if (code === 0) resolve(output.trim() || pythonExe);
                else reject(new Error(output.trim() || `Python exited with code ${code}`));
            });
        });
    }

    async checkEngineHealth(showNotice = false, force = false) {
        const fs = require('fs');
        const key = this._engineHealthKey();
        if (!force && this.engineHealth && this.engineHealth.key === key && Date.now() - this.engineHealth.checkedAt < 60000) {
            if (showNotice) {
                new Notice(this.engineHealth.status === 'ready'
                    ? t(this, 'engine_health_ok_notice')
                    : t(this, 'engine_health_problem_notice', { message: this.engineHealth.message }));
            }
            return this.engineHealth;
        }

        const issues = [];
        const checks = emptyChecks();
        const engineDir = this._engineDir();
        const pythonPath = this._pythonExe();
        const vaultBase = this._vaultBasePath ? this._vaultBasePath() : null;
        const vaultUnderstoryPath = vaultBase ? this._joinPath(vaultBase, '.understory') : '';
        let pythonVersion = '';
        let engineVersion = 'unknown';
        let engineCommit = 'unknown';

        const pipInstallCommand = engineDir
            ? `${pythonPath} -m pip install -r "${this._joinPath(engineDir, 'requirements.txt')}"`
            : `${pythonPath} -m pip install -r "<engineDir>/requirements.txt"`;
        const addIssue = (input) => {
            const issue = createEngineHealthIssue(input);
            issues.push(issue);
            return issue;
        };

        if (!engineDir) {
            addCheck(checks, 'paths', {
                id: 'engine.dir',
                label: t(this, 'engine_check_engine_dir_label'),
                status: 'error',
                severity: 'error',
                detail: t(this, 'engine_missing_dir'),
            });
            addIssue({
                id: 'engine.dir_missing',
                severity: 'error',
                group: 'paths',
                title: t(this, 'engine_issue_dir_missing_title'),
                detail: t(this, 'engine_missing_dir'),
                fix: t(this, 'engine_issue_dir_missing_fix'),
                command: '$env:UNDERSTORY_ENGINE_DIR="C:\\path\\to\\Understory-graphify-engine"',
            });
        } else {
            const engineAccess = checkPathAccess(engineDir, 'read', fs);
            addCheck(checks, 'paths', {
                id: 'engine.dir',
                label: t(this, 'engine_check_engine_dir_label'),
                status: engineAccess.ok ? 'ok' : 'error',
                severity: engineAccess.ok ? 'info' : 'error',
                detail: engineAccess.ok
                    ? t(this, 'engine_check_ok')
                    : t(this, engineAccess.exists ? 'engine_permission_read_failed' : 'engine_dir_not_found', { path: engineDir, message: engineAccess.errorMessage }),
                path: engineDir,
            });

            if (!engineAccess.exists) {
                addIssue({
                    id: 'engine.dir_not_found',
                    severity: 'error',
                    group: 'paths',
                    title: t(this, 'engine_issue_dir_not_found_title'),
                    detail: t(this, 'engine_dir_not_found', { path: engineDir }),
                    fix: t(this, 'engine_issue_dir_not_found_fix'),
                    command: 'git clone https://github.com/fyaic/Understory-graphify-engine.git',
                    path: engineDir,
                });
            } else if (!engineAccess.ok) {
                addIssue({
                    id: 'engine.dir_unreadable',
                    severity: 'error',
                    group: 'permissions',
                    title: t(this, 'engine_issue_permission_title'),
                    detail: t(this, 'engine_permission_read_failed', { path: engineDir, message: engineAccess.errorMessage }),
                    fix: t(this, 'engine_issue_permission_fix'),
                    path: engineDir,
                });
            } else {
                const versionInfo = readEngineVersion(engineDir);
                engineVersion = versionInfo.version;
                engineCommit = versionInfo.commit;

                for (const script of REQUIRED_ENGINE_SCRIPTS) {
                    const scriptPath = this._joinPath(engineDir, ...script.pathParts);
                    const access = checkPathAccess(scriptPath, 'read', fs);
                    addCheck(checks, script.group, {
                        id: script.id,
                        label: script.label,
                        status: access.ok ? 'ok' : (script.severity === 'error' ? 'error' : 'warning'),
                        severity: access.ok ? 'info' : script.severity,
                        detail: access.ok
                            ? t(this, 'engine_check_ok')
                            : t(this, 'engine_script_missing_detail', { script: script.label, path: scriptPath }),
                        path: scriptPath,
                    });
                    if (!access.ok) {
                        addIssue({
                            id: script.id,
                            severity: script.severity,
                            group: script.group,
                            title: t(this, script.id === 'engine.api_missing' ? 'engine_issue_api_missing_title' : 'engine_issue_script_missing_title', { script: script.label }),
                            detail: t(this, 'engine_script_missing_detail', { script: script.label, path: scriptPath }),
                            fix: t(this, script.severity === 'error' ? 'engine_issue_script_missing_fix_error' : 'engine_issue_script_missing_fix_warning'),
                            command: script.severity === 'error' ? 'git clone https://github.com/fyaic/Understory-graphify-engine.git' : '',
                            path: scriptPath,
                        });
                    }
                }
            }
        }

        try {
            pythonVersion = await this._checkPythonVersion();
        } catch (error) {
            const message = redactSensitiveText(String(error.message || error), this.settings);
            addIssue({
                id: 'engine.python_failed',
                severity: 'error',
                group: 'dependencies',
                title: t(this, 'engine_issue_python_failed_title'),
                detail: t(this, 'engine_python_failed', { message }),
                fix: t(this, 'engine_issue_python_failed_fix'),
                command: `${pythonPath} --version`,
            });
        }

        if (pythonVersion) {
            addCheck(checks, 'dependencies', {
                id: 'engine.python',
                label: t(this, 'engine_check_python_label'),
                status: 'ok',
                severity: 'info',
                detail: pythonVersion,
                path: pythonPath,
            });
            if (force) {
                for (const moduleInfo of REQUIRED_PYTHON_MODULES) {
                    try {
                        await this._checkPythonModule(moduleInfo.importName);
                        addCheck(checks, 'dependencies', {
                            id: moduleInfo.id,
                            label: moduleInfo.packageName,
                            status: 'ok',
                            severity: 'info',
                            detail: t(this, 'engine_check_ok'),
                        });
                    } catch (error) {
                        const message = redactSensitiveText(String(error.message || error), this.settings);
                        addCheck(checks, 'dependencies', {
                            id: moduleInfo.id,
                            label: moduleInfo.packageName,
                            status: 'warning',
                            severity: 'warning',
                            detail: message,
                        });
                        addIssue({
                            id: moduleInfo.id,
                            severity: 'warning',
                            group: 'dependencies',
                            title: t(this, 'engine_issue_dependency_missing_title', { name: moduleInfo.packageName }),
                            detail: t(this, 'engine_issue_dependency_missing_detail', { name: moduleInfo.packageName, module: moduleInfo.importName, message }),
                            fix: t(this, 'engine_issue_dependency_missing_fix'),
                            command: pipInstallCommand,
                        });
                    }
                }
            } else {
                addCheck(checks, 'dependencies', {
                    id: 'engine.dependencies',
                    label: t(this, 'engine_check_dependencies_label'),
                    status: 'skipped',
                    severity: 'info',
                    detail: t(this, 'engine_check_dependencies_skipped'),
                });
            }
        } else {
            addCheck(checks, 'dependencies', {
                id: 'engine.python',
                label: t(this, 'engine_check_python_label'),
                status: 'error',
                severity: 'error',
                detail: t(this, 'engine_python_failed', { message: pythonPath }),
                path: pythonPath,
            });
        }

        if (!vaultBase) {
            addCheck(checks, 'vault', {
                id: 'engine.vault_base',
                label: t(this, 'engine_check_vault_label'),
                status: 'skipped',
                severity: 'info',
                detail: t(this, 'engine_vault_base_skipped'),
            });
        } else {
            const vaultDirExists = fs.existsSync(vaultUnderstoryPath);
            addCheck(checks, 'vault', {
                id: 'engine.vault_understory',
                label: t(this, 'engine_check_vault_understory_label'),
                status: vaultDirExists ? 'ok' : 'warning',
                severity: vaultDirExists ? 'info' : 'warning',
                detail: vaultDirExists ? t(this, 'engine_check_ok') : t(this, 'engine_vault_understory_missing', { path: vaultUnderstoryPath }),
                path: vaultUnderstoryPath,
            });
            if (!vaultDirExists) {
                addIssue({
                    id: 'engine.vault_understory_missing',
                    severity: 'warning',
                    group: 'vault',
                    title: t(this, 'engine_issue_vault_missing_title'),
                    detail: t(this, 'engine_vault_understory_missing', { path: vaultUnderstoryPath }),
                    fix: t(this, 'engine_issue_vault_missing_fix'),
                    command: engineDir ? `${pythonPath} "${this._joinPath(engineDir, 'scripts', 'deploy_graphify.py')}" --vault "${vaultBase}"` : '',
                    path: vaultUnderstoryPath,
                });
                const vaultRootAccess = checkPathAccess(vaultBase, 'write', fs);
                if (!vaultRootAccess.ok) {
                    addIssue({
                        id: 'engine.vault_root_not_writable',
                        severity: 'warning',
                        group: 'permissions',
                        title: t(this, 'engine_issue_vault_permission_title'),
                        detail: t(this, 'engine_permission_write_failed', { path: vaultBase, message: vaultRootAccess.errorMessage }),
                        fix: t(this, 'engine_issue_vault_permission_fix'),
                        path: vaultBase,
                    });
                }
            } else {
                const vaultWriteAccess = checkPathAccess(vaultUnderstoryPath, 'write', fs);
                addCheck(checks, 'permissions', {
                    id: 'engine.vault_understory_write',
                    label: t(this, 'engine_check_vault_write_label'),
                    status: vaultWriteAccess.ok ? 'ok' : 'error',
                    severity: vaultWriteAccess.ok ? 'info' : 'error',
                    detail: vaultWriteAccess.ok
                        ? t(this, 'engine_check_ok')
                        : t(this, 'engine_permission_write_failed', { path: vaultUnderstoryPath, message: vaultWriteAccess.errorMessage }),
                    path: vaultUnderstoryPath,
                });
                if (!vaultWriteAccess.ok) {
                    addIssue({
                        id: 'engine.vault_understory_not_writable',
                        severity: 'error',
                        group: 'permissions',
                        title: t(this, 'engine_issue_vault_permission_title'),
                        detail: t(this, 'engine_permission_write_failed', { path: vaultUnderstoryPath, message: vaultWriteAccess.errorMessage }),
                        fix: t(this, 'engine_issue_vault_permission_fix'),
                        path: vaultUnderstoryPath,
                    });
                }

                const vaultScriptsPath = this._joinPath(vaultUnderstoryPath, 'scripts');
                const vaultScriptsExist = fs.existsSync(vaultScriptsPath);
                addCheck(checks, 'vault', {
                    id: 'engine.vault_scripts',
                    label: t(this, 'engine_check_vault_scripts_label'),
                    status: vaultScriptsExist ? 'ok' : 'warning',
                    severity: vaultScriptsExist ? 'info' : 'warning',
                    detail: vaultScriptsExist ? t(this, 'engine_check_ok') : t(this, 'engine_vault_scripts_missing', { path: vaultScriptsPath }),
                    path: vaultScriptsPath,
                });
                if (!vaultScriptsExist) {
                    addIssue({
                        id: 'engine.vault_scripts_missing',
                        severity: 'warning',
                        group: 'vault',
                        title: t(this, 'engine_issue_vault_scripts_missing_title'),
                        detail: t(this, 'engine_vault_scripts_missing', { path: vaultScriptsPath }),
                        fix: t(this, 'engine_issue_vault_missing_fix'),
                        command: engineDir ? `${pythonPath} "${this._joinPath(engineDir, 'scripts', 'deploy_graphify.py')}" --vault "${vaultBase}"` : '',
                        path: vaultScriptsPath,
                    });
                }
            }
        }

        const status = statusFromIssues(issues);
        const ok = status !== 'error';
        const message = issues.length ? summarizeIssue(issues[0]) : '';
        this.engineHealth = {
            ok,
            status,
            key,
            pluginVersion: this.manifest?.version || this.app?.plugins?.manifests?.understory?.version || 'unknown',
            engineDir,
            engineVersion,
            engineCommit,
            pythonPath,
            pythonVersion,
            vaultBase,
            vaultUnderstoryPath,
            checks,
            issues,
            fixes: issues.filter((issue) => issue.fix || issue.command),
            message,
            checkedAt: Date.now(),
        };
        this.engineHealth.diagnosticText = buildEngineDiagnosticText(this.engineHealth, this.settings);

        if (showNotice) {
            new Notice(this.engineHealth.status === 'ready'
                ? t(this, 'engine_health_ok_notice')
                : t(this, 'engine_health_problem_notice', { message: this.engineHealth.message }), 7000);
        }

        return this.engineHealth;
    }

    async _ensureEngineReady(showNotice = true) {
        const health = await this.checkEngineHealth(false);
        if (health.ok) return true;
        if (showNotice) {
            new Notice(t(this, 'engine_health_problem_notice', { message: health.message }));
        }
        return false;
    }

    _runPythonScript(scriptPath, args, timeoutMs = 0) {
        const { spawn } = require('child_process');
        const fs = require('fs');
        const pythonExe = this._pythonExe();
        return new Promise((resolve, reject) => {
            if (!scriptPath || !fs.existsSync(scriptPath)) {
                reject(new Error(t(this, 'engine_script_missing', { path: scriptPath || '(empty)' })));
                return;
            }
            const proc = spawn(pythonExe, [scriptPath, ...args], {
                env: this._pythonEnv(),
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            let timer = null;
            if (timeoutMs > 0) {
                timer = window.setTimeout(() => {
                    try { proc.kill(); } catch (e) { /* ignore */ }
                    reject(new Error(`Script timed out after ${timeoutMs}ms: ${scriptPath}`));
                }, timeoutMs);
            }
            if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d; });
            if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d; });
            proc.on('error', (e) => { if (timer) window.clearTimeout(timer); reject(e); });
            proc.on('close', (code) => {
                if (timer) window.clearTimeout(timer);
                if (code === 0) resolve(stdout);
                else reject(new Error(`Script failed (${code}): ${safeErrorDetail({ stderr, settings: this.settings })}`));
            });
        });
    }

    _parseEngineJsonOutput(stdout) {
        const text = String(stdout || '').trim();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (error) {
            const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            for (let index = lines.length - 1; index >= 0; index -= 1) {
                const line = lines[index];
                if (!line.startsWith('{') || !line.endsWith('}')) continue;
                try {
                    return JSON.parse(line);
                } catch (lineError) {
                    // Keep looking for an earlier JSON line.
                }
            }
        }
        return null;
    }

    _runEngineApi(args, timeoutMs = 0) {
        const { spawn } = require('child_process');
        const fs = require('fs');
        const apiPath = this._enginePath('api.py');
        const pythonExe = this._pythonExe();
        return new Promise((resolve, reject) => {
            if (!apiPath || !fs.existsSync(apiPath)) {
                reject(new Error(t(this, 'engine_script_missing', { path: apiPath || '(empty)' })));
                return;
            }
            const proc = spawn(pythonExe, [apiPath, ...args], {
                cwd: this._engineDir(),
                env: this._pythonEnv(),
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            let outputOverflowed = false;
            let settled = false;
            let timer = null;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                if (timer) window.clearTimeout(timer);
                fn(value);
            };
            const append = (current, data) => {
                const next = current + data.toString();
                if (next.length <= MAX_PROCESS_OUTPUT_BYTES) return next;
                outputOverflowed = true;
                try { proc.kill(); } catch (error) { /* ignore */ }
                return next.slice(0, MAX_PROCESS_OUTPUT_BYTES);
            };
            if (timeoutMs > 0) {
                timer = window.setTimeout(() => {
                    try { proc.kill(); } catch (error) { /* ignore */ }
                    finish(reject, new Error(`api.py timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }
            proc.stdout?.on('data', (data) => { stdout = append(stdout, data); });
            proc.stderr?.on('data', (data) => { stderr = append(stderr, data); });
            proc.on('error', (error) => finish(reject, error));
            proc.on('close', (code) => {
                if (outputOverflowed) {
                    finish(reject, new Error(`Process output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes.`));
                    return;
                }
                const payload = this._parseEngineJsonOutput(stdout);
                if (payload) {
                    finish(resolve, { code, stdout, stderr, payload });
                    return;
                }
                if (code === 0) {
                    finish(resolve, { code, stdout, stderr, payload: null });
                    return;
                }
                finish(reject, new Error(safeErrorDetail({
                    stdout,
                    stderr,
                    message: `api.py exited with code ${code}`,
                    settings: this.settings,
                })));
            });
        });
    }

    async checkEmbeddingHealth(showNotice = false, force = false) {
        if (!force && this.embeddingHealth) return this.embeddingHealth;
        const networkMode = safeNetworkMode(this.settings?.networkMode);
        const provider = String(this.settings?.embeddingProvider || 'zhipu').trim() || 'zhipu';

        if (networkMode === 'local') {
            const health = {
                status: 'ok',
                semantic_state: 'local_only',
                indexing: 'skipped',
                network_mode: networkMode,
                provider,
                embedding_allowed: false,
                provider_ready: false,
                index_ready: false,
                recommended_action: 'configure_vector_model',
                message: t(this, 'embedding_status_local_desc'),
            };
            this.embeddingHealth = health;
            if (showNotice) new Notice(t(this, 'embedding_check_ready_notice'));
            return health;
        }

        if (provider === 'none') {
            const health = {
                status: 'warning',
                semantic_state: 'provider_disabled',
                indexing: 'disabled',
                network_mode: networkMode,
                provider,
                embedding_allowed: false,
                provider_ready: false,
                index_ready: false,
                recommended_action: 'configure_vector_model',
                message: t(this, 'embedding_status_provider_disabled_desc'),
            };
            this.embeddingHealth = health;
            if (showNotice) new Notice(t(this, 'embedding_check_attention_notice', { message: health.message }));
            return health;
        }

        try {
            if (this.checkEngineHealth) {
                const engineHealth = await this.checkEngineHealth(false, force);
                if (engineHealth && !engineHealth.ok) {
                    const health = {
                        status: 'error',
                        semantic_state: 'engine_not_ready',
                        indexing: 'unavailable',
                        network_mode: networkMode,
                        provider,
                        message: engineHealth.message || t(this, 'embedding_status_engine_not_ready_desc'),
                        recommended_action: 'check_engine_setup',
                    };
                    this.embeddingHealth = health;
                    if (showNotice) new Notice(t(this, 'embedding_check_failed_notice', { message: health.message }));
                    return health;
                }
            }
            const args = ['embedding-status'];
            const base = this._vaultBasePath ? this._vaultBasePath() : null;
            if (base) args.push('--vault', base);
            const { code, stderr, payload } = await this._runEngineApi(args, 30000);
            const health = payload && typeof payload === 'object'
                ? { ...payload, network_mode: networkMode, provider: payload.provider || provider, exit_code: code }
                : {
                    status: 'error',
                    semantic_state: 'status_failed',
                    indexing: 'unavailable',
                    network_mode: networkMode,
                    provider,
                    message: t(this, 'embedding_status_failed_desc'),
                    exit_code: code,
                };
            if (stderr && !health.diagnostic) {
                health.diagnostic = safeErrorDetail({ stderr, settings: this.settings });
            }
            this.embeddingHealth = health;
            if (showNotice) {
                const key = health.status === 'ok'
                    ? 'embedding_check_ready_notice'
                    : health.status === 'warning'
                        ? 'embedding_check_attention_notice'
                        : 'embedding_check_failed_notice';
                new Notice(t(this, key, { message: health.message || '' }));
            }
            return health;
        } catch (error) {
            const message = safeErrorDetail({ message: error?.message || String(error), settings: this.settings });
            const health = {
                status: 'error',
                semantic_state: 'status_failed',
                indexing: 'unavailable',
                network_mode: networkMode,
                provider,
                message,
                recommended_action: 'check_engine_setup',
            };
            this.embeddingHealth = health;
            if (showNotice) new Notice(t(this, 'embedding_check_failed_notice', { message }));
            return health;
        }
    }

    async _addLogEntry(entry) {
        if (!this.settings.linkLog) this.settings.linkLog = [];
        this.settings.linkLog.unshift(normalizeLogEntry(entry, this.settings));
        if (this.settings.linkLog.length > MAX_LOG_ENTRIES) {
            this.settings.linkLog = this.settings.linkLog.slice(0, MAX_LOG_ENTRIES);
        }
        await this.saveSettings();
    }

    _formatTime(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    /**
     * 确保 stdout/stderr 都接收完毕后再处理结果（避免 EOF 报错）
     */
    async _maybeProcessResult(file, code, stdout, stderr, stdoutEnded, stderrEnded, options = {}) {
        if (code === null) return; // 进程还没退出
        if (!stdoutEnded || !stderrEnded) return; // 数据还没收完，等待
        const notify = options.notify !== false;

        if (code !== 0) {
            const engineMessage = extractProcessJsonMessage(stdout);
            const diagnosticText = stderr || engineMessage;
            const errorInfo = this._classifyError(diagnosticText);
            if (notify && this._shouldShowRunNotice(`error:${errorInfo.category}:${errorInfo.desc}`)) {
                new Notice(t(this, 'run_failed_notice', { category: errorInfo.category, desc: errorInfo.desc }));
            }
            await this._addLogEntry({
                time: this._formatTime(new Date()),
                file: file.basename,
                filePath: file.path,
                status: 'error',
                count: 0,
                relations: [],
                message: errorInfo.desc,
                errorCategory: errorInfo.category,
                errorDetail: safeErrorDetail({
                    stderr,
                    message: engineMessage,
                    settings: this.settings
                })
            });
            return;
        }

        await this._parseAndLogResult(file, stdout, stderr, { notify });
    }

    /**
     * Async 版本的结果处理
     */
    /**
     * 解析 stdout JSON 并记录日志（统一入口）
     */
    async _parseAndLogResult(file, stdout, stderr, options = {}) {
        const raw = stdout.trim();
        const notify = options.notify !== false;
        if (!raw) {
            // stdout 为空 = Python 异常崩溃且未输出 JSON（旧版本或极端情况）
            const errorInfo = this._classifyError(stderr);
            await this._addLogEntry({
                time: this._formatTime(new Date()),
                file: file.basename,
                filePath: file.path,
                status: 'error',
                count: 0,
                relations: [],
                message: t(this, 'log_python_crash', { message: errorInfo.desc }),
                errorCategory: errorInfo.category,
                errorDetail: safeErrorDetail({
                    stderr,
                    message: t(this, 'process_empty_stdout_detail'),
                    settings: this.settings,
                })
            });
            return;
        }

        try {
            const result = JSON.parse(raw);
            if (result.status === 'ok') {
                if (this.relationsStore) {
                    try {
                        const entry = await this.relationsStore.updateFromResult(file, result);
                        const placement = this.settings?.presentationMode || 'sidebar';
                        if (this._shouldUseHostedDiscovery?.() && (placement === 'body' || placement === 'both')) {
                            await this.relationsStore.syncSuggestedRelationsIntoBody(file, entry?.relations || []);
                        }
                    } catch (error) {
                        recordBackgroundError(this, 'update-relations-cache', error);
                    }
                }
                this._showEngineGuidance(result, notify);
                const count = result.relations_count || 0;
                const rels = (result.relations || []).map(r => r.title || r.file || 'unknown');
                if (notify) {
                    this._showClickableNotice(
                        t(this, 'relations_found_notice', { note: file.basename, count }),
                        file.path
                    );
                }
                await this._addLogEntry({
                    time: this._formatTime(new Date()),
                    file: file.basename,
                    filePath: file.path,
                    status: 'ok',
                    count: count,
                    relations: rels
                });
            } else if (result.status === 'skipped') {
                this._showEngineGuidance(result, notify);
                await this._addLogEntry({
                    time: this._formatTime(new Date()),
                    file: file.basename,
                    filePath: file.path,
                    status: 'skipped',
                    count: 0,
                    relations: [],
                    message: result.reason || 'skipped'
                });
            } else if (result.status === 'error') {
                // Python 端已捕获的异常（新版）
                const errorInfo = this._classifyError(result.message + ' ' + (result.error_detail || ''));
                await this._addLogEntry({
                    time: this._formatTime(new Date()),
                    file: file.basename,
                    filePath: file.path,
                    status: 'error',
                    count: 0,
                    relations: [],
                    message: errorInfo.desc,
                    errorCategory: errorInfo.category,
                    errorDetail: safeErrorDetail({
                        stderr: result.error_detail,
                        message: result.message,
                        settings: this.settings,
                    })
                });
            } else {
                await this._addLogEntry({
                    time: this._formatTime(new Date()),
                    file: file.basename,
                    filePath: file.path,
                    status: 'unknown',
                    count: 0,
                    relations: [],
                    message: result.message || 'unknown'
                });
            }
        } catch (error) {
            // JSON 解析失败（输出损坏或不完整）
            recordBackgroundError(this, 'parse-local-engine-result', error);
            const errorInfo = this._classifyError(stderr);
            await this._addLogEntry({
                time: this._formatTime(new Date()),
                file: file.basename,
                filePath: file.path,
                status: 'parse_error',
                count: 0,
                relations: [],
                message: t(this, 'parse_failed_message'),
                errorCategory: errorInfo.category !== t(this, 'error_unknown_category') ? errorInfo.category : t(this, 'parse_error_category'),
                errorDetail: safeErrorDetail({ stdout: raw, stderr, settings: this.settings })
            });
        }
    }

    _showEngineGuidance(result, notify = false) {
        const fixes = Array.isArray(result?.fixes) ? result.fixes : [];
        const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
        const indexFix = fixes.find((fix) => fix && fix.id === 'embedding_index_missing');
        if (indexFix) {
            if (notify && this._shouldShowRunNotice('embedding-index-missing')) {
                new Notice(t(this, 'embedding_index_missing_notice'), 10000);
            }
            if (this.checkEmbeddingHealth) {
                this.checkEmbeddingHealth(false, true).catch((error) => {
                    recordBackgroundError(this, 'refresh-embedding-status', error);
                });
            }
        }
        if (warnings.length || fixes.length) {
            const detail = JSON.stringify({ warnings, fixes });
            this.lastEngineGuidance = redactSensitiveText(detail, this.settings);
        }
    }

    /**
     * 对 stderr 内容进行失败归因分类
     */
    _classifyError(stderr) {
        const text = (stderr || '').toLowerCase();

        if (text.includes('api_key') || text.includes('zhipu_api_key') || text.includes('credentials')) {
            return { category: t(this, 'error_config_category'), desc: t(this, 'error_config_desc') };
        }
        if (text.includes('timeout') || text.includes('\u8d85\u65f6')) {
            return { category: t(this, 'error_timeout_category'), desc: t(this, 'error_timeout_desc') };
        }
        if (text.includes('connection') || text.includes('\u8fde\u63a5') || text.includes('errno')) {
            return { category: t(this, 'error_network_category'), desc: t(this, 'error_network_desc') };
        }
        if (text.includes('requests') || text.includes('\u4f9d\u8d56') || text.includes('module')) {
            return { category: t(this, 'error_env_category'), desc: t(this, 'error_deps_desc') };
        }
        if (text.includes('embedding_index.sqlite') || text.includes('\u7f13\u5b58') || text.includes('\u672a\u627e\u5230') || text.includes('filenotfounderror')) {
            return { category: t(this, 'error_index_category'), desc: t(this, 'error_index_desc') };
        }
        if (text.includes('\u5185\u5bb9\u8fc7\u77ed') || text.includes('\u8fc7\u77ed')) {
            return { category: t(this, 'error_content_category'), desc: t(this, 'error_content_desc') };
        }
        if (text.includes('\u4e0d\u5b58\u5728') || text.includes('not found')) {
            return { category: t(this, 'error_file_category'), desc: t(this, 'error_file_desc') };
        }
        if (text.includes('python') || text.includes('\u672a\u627e\u5230')) {
            return { category: t(this, 'error_env_category'), desc: t(this, 'error_python_desc') };
        }

        return { category: t(this, 'error_unknown_category'), desc: redactSensitiveText(stderr, this.settings).slice(0, 100) || t(this, 'error_unknown_desc') };
    }

    _shouldShowRunNotice(key, cooldownMs = 10000) {
        if (!this._understoryNoticeCooldowns) this._understoryNoticeCooldowns = new Map();
        const now = Date.now();
        const previous = Number(this._understoryNoticeCooldowns.get(key) || 0);
        if (now - previous < cooldownMs) return false;
        this._understoryNoticeCooldowns.set(key, now);
        return true;
    }

    _showClickableNotice(message, filePath, duration = 6000) {
        const notice = new Notice(message, duration);
        if (notice.el && filePath) {
            notice.el.addClass?.('understory-clickable-notice');
            notice.el.addEventListener('click', () => {
                notice.hide();
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    this.app.workspace.getLeaf().openFile(file);
                } else {
                    new Notice(t(this, 'open_file_failed', { path: filePath }));
                }
            });
        }
        return notice;
    }
}

module.exports = GraphifyRuntimeMethods.prototype;
