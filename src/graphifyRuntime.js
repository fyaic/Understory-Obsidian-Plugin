const { Notice, TFile } = require('obsidian');
const { GraphifyContentModal } = require('./utils');
const { t } = require('./i18n');

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
                const row = list.createEl('div');
                row.style.padding = '3px 0';
                row.style.borderBottom = '1px solid var(--background-modifier-border)';
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
        const env = {
            ...process.env,
            UNDERSTORY_ENGINE_DIR: this._engineDir(),
            OBSIDIAN_VAULT_PATH: vaultBase || process.env.OBSIDIAN_VAULT_PATH || '',
            UNDERSTORY_NETWORK_MODE: this.settings?.networkMode || 'local',
            UNDERSTORY_WEBHOOK_ENABLED: this.settings?.webhookEnabled ? '1' : '0',
            PYTHONIOENCODING: 'utf-8',
            ...extra,
        };
        const setIfPresent = (key, value) => {
            const text = String(value || '').trim();
            if (text) env[key] = text;
        };
        setIfPresent('UNDERSTORY_EMBEDDING_PROVIDER', this.settings?.embeddingProvider);
        setIfPresent('UNDERSTORY_LLM_PROVIDER', this.settings?.llmProvider);
        setIfPresent('UNDERSTORY_EMBEDDING_BASE_URL', this.settings?.embeddingBaseUrl);
        setIfPresent('UNDERSTORY_EMBEDDING_MODEL', this.settings?.embeddingModel);
        setIfPresent('UNDERSTORY_EMBEDDING_DIMENSIONS', this.settings?.embeddingDimensions);
        setIfPresent('UNDERSTORY_EMBEDDING_API_KEY', this.settings?.embeddingApiKey);
        setIfPresent('UNDERSTORY_LLM_BASE_URL', this.settings?.llmBaseUrl);
        setIfPresent('UNDERSTORY_LLM_MODEL', this.settings?.llmModel);
        setIfPresent('UNDERSTORY_LLM_API_KEY', this.settings?.llmApiKey);
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

    _runPythonProbe(args, timeoutMs = 5000) {
        const { spawn } = require('child_process');
        const pythonExe = this._pythonExe();
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonExe, args, {
                env: this._pythonEnv(),
                windowsHide: true,
            });
            let output = '';
            let timer = setTimeout(() => {
                try { proc.kill(); } catch (error) { /* ignore */ }
                reject(new Error(t(this, 'engine_python_timeout')));
            }, timeoutMs);
            proc.stdout?.on('data', (data) => { output += data.toString(); });
            proc.stderr?.on('data', (data) => { output += data.toString(); });
            proc.on('error', (error) => {
                if (timer) clearTimeout(timer);
                timer = null;
                reject(error);
            });
            proc.on('close', (code) => {
                if (timer) clearTimeout(timer);
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
                new Notice(this.engineHealth.ok
                    ? t(this, 'engine_health_ok_notice')
                    : t(this, 'engine_health_problem_notice', { message: this.engineHealth.message }));
            }
            return this.engineHealth;
        }

        const issues = [];
        const engineDir = this._engineDir();
        let pythonVersion = '';

        if (!engineDir) {
            issues.push(t(this, 'engine_missing_dir'));
        } else if (!fs.existsSync(engineDir)) {
            issues.push(t(this, 'engine_dir_not_found', { path: engineDir }));
        } else {
            const apiPath = this._enginePath('api.py');
            const scriptsPath = this._enginePath('scripts');
            if (!fs.existsSync(apiPath)) issues.push(t(this, 'engine_api_missing', { path: apiPath }));
            if (!fs.existsSync(scriptsPath)) issues.push(t(this, 'engine_scripts_missing', { path: scriptsPath }));
        }

        try {
            pythonVersion = await this._checkPythonVersion();
        } catch (error) {
            issues.push(t(this, 'engine_python_failed', { message: String(error.message || error) }));
        }

        if (pythonVersion) {
            try {
                await this._checkPythonModules();
            } catch (error) {
                issues.push(t(this, 'engine_deps_failed', { message: String(error.message || error) }));
            }
        }

        const ok = issues.length === 0;
        this.engineHealth = {
            ok,
            key,
            engineDir,
            pythonPath: this._pythonExe(),
            pythonVersion,
            issues,
            message: issues[0] || '',
            checkedAt: Date.now(),
        };

        if (showNotice) {
            new Notice(ok
                ? t(this, 'engine_health_ok_notice')
                : t(this, 'engine_health_problem_notice', { message: this.engineHealth.message }), 7000);
        }

        return this.engineHealth;
    }

    async _ensureEngineReady(showNotice = true) {
        const health = await this.checkEngineHealth(false);
        if (health.ok) return true;
        console.warn('[Understory] Engine is not ready:', health.issues);
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
                timer = setTimeout(() => {
                    try { proc.kill(); } catch (e) { /* ignore */ }
                    reject(new Error(`Script timed out after ${timeoutMs}ms: ${scriptPath}`));
                }, timeoutMs);
            }
            if (proc.stdout) proc.stdout.on('data', (d) => { stdout += d; });
            if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d; });
            proc.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
            proc.on('close', (code) => {
                if (timer) clearTimeout(timer);
                if (code === 0) resolve(stdout);
                else reject(new Error(`Script failed (${code}): ${stderr.slice(0, 300)}`));
            });
        });
    }

    async _addLogEntry(entry) {
        if (!this.settings.linkLog) this.settings.linkLog = [];
        this.settings.linkLog.unshift(entry);
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
    async _maybeProcessResult(file, code, stdout, stderr, stdoutEnded, stderrEnded) {
        if (code === null) return; // 进程还没退出
        if (!stdoutEnded || !stderrEnded) return; // 数据还没收完，等待

        if (code !== 0) {
            const errorInfo = this._classifyError(stderr);
            console.error(`[Understory] Failed [${errorInfo.category}]: ${errorInfo.desc}`);
            new Notice(t(this, 'run_failed_notice', { category: errorInfo.category, desc: errorInfo.desc }));
            await this._addLogEntry({
                time: this._formatTime(new Date()),
                file: file.basename,
                filePath: file.path,
                status: 'error',
                count: 0,
                relations: [],
                message: errorInfo.desc,
                errorCategory: errorInfo.category,
                errorDetail: stderr.slice(0, 300)
            });
            return;
        }

        await this._parseAndLogResult(file, stdout, stderr);
    }

    /**
     * Async 版本的结果处理
     */
    /**
     * 解析 stdout JSON 并记录日志（统一入口）
     */
    async _parseAndLogResult(file, stdout, stderr) {
        const raw = stdout.trim();
        if (!raw) {
            // stdout 为空 = Python 异常崩溃且未输出 JSON（旧版本或极端情况）
            const errorInfo = this._classifyError(stderr);
            console.error('[Understory] Empty stdout, Python likely crashed:', stderr);
            await this._addLogEntry({
                time: this._formatTime(new Date()),
                file: file.basename,
                filePath: file.path,
                status: 'error',
                count: 0,
                relations: [],
                message: t(this, 'log_python_crash', { message: errorInfo.desc }),
                errorCategory: errorInfo.category,
                errorDetail: stderr.slice(0, 300) || t(this, 'process_empty_stdout_detail')
            });
            return;
        }

        try {
            const result = JSON.parse(raw);
            if (result.status === 'ok') {
                if (this.relationsStore) {
                    try {
                        await this.relationsStore.updateFromResult(file, result);
                    } catch (error) {
                        console.error('[Understory] Failed to update relations cache:', error);
                    }
                }
                const count = result.relations_count || 0;
                const rels = (result.relations || []).map(r => r.title || r.file || 'unknown');
                this._showClickableNotice(
                    t(this, 'relations_found_notice', { note: file.basename, count }),
                    file.path
                );
                await this._addLogEntry({
                    time: this._formatTime(new Date()),
                    file: file.basename,
                    filePath: file.path,
                    status: 'ok',
                    count: count,
                    relations: rels
                });
            } else if (result.status === 'skipped') {
                console.log(`[Understory] Skipped: [[${file.basename}]] ${result.reason || 'skipped'}`);
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
                console.error(`[Understory] Python error: ${result.message}`);
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
                    errorDetail: result.error_detail || result.message
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
        } catch (e) {
            // JSON 解析失败（输出损坏或不完整）
            console.error('[Understory] JSON parse error:', e, 'raw:', raw.slice(0, 200));
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
                errorDetail: `stdout: ${raw.slice(0, 200)}\nstderr: ${stderr.slice(0, 200)}`
            });
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

        return { category: t(this, 'error_unknown_category'), desc: stderr.slice(0, 100) || t(this, 'error_unknown_desc') };
    }

    _showClickableNotice(message, filePath, duration = 6000) {
        const notice = new Notice(message, duration);
        if (notice.el && filePath) {
            notice.el.style.cursor = 'pointer';
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
