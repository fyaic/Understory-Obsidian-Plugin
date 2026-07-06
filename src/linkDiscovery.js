const { Notice, TFile } = require('obsidian');
const { MAX_PROCESS_OUTPUT_BYTES } = require('./utils');
const { DEFAULT_SETTINGS, getDefaultEngineDir, getDefaultPythonPath, repairPythonPath } = require('./settings');
const { t } = require('./i18n');
const { normalizeSettings } = require('./safety');

class LinkDiscoveryMethods {
    scheduleLink(file) {
        if (!file) return;
        const path = file.path;

        // 黑名单过滤：跳过排除文件夹中的文件
        if (this._isPathExcluded(path)) {
            console.log(`[Understory] Skipped scheduling (excluded folder): ${path}`);
            return;
        }

        // 0509-repeat-fix: 文件创建后固定等待10分钟，期间不重置定时器
        // 确保即使文件被反复编辑，10分钟后也必定执行一次关联发现
        if (this.timers.has(path)) {
            console.log(`[Understory] Timer already running for ${path}, not resetting`);
            return;
        }

        const delay = (this.settings.debounceMinutes || 10) * 60 * 1000;
        const timer = setTimeout(() => this.runGraphify(file), delay);
        this.timers.set(path, timer);

        console.log(`[Understory] Scheduled link discovery for ${path} in ${this.settings.debounceMinutes}min`);
    }

    _clearScheduledLink(path) {
        if (!path || !this.timers.has(path)) return;
        clearTimeout(this.timers.get(path));
        this.timers.delete(path);
        console.log(`[Understory] Cleared scheduled link discovery for ${path}`);
    }

    async linkNow() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') {
            new Notice(t(this, 'sidebar_need_markdown'));
            return;
        }
        if (this._isPathExcluded(file.path)) {
            new Notice(t(this, 'notice_note_excluded'));
            return;
        }
        await this.runGraphify(file);
    }

    async _runGraphifyProcess(file, refresh = false) {
        const { spawn } = require('child_process');
        if (this._ensureEngineReady && !(await this._ensureEngineReady(true))) {
            return { code: -1, stdout: '', stderr: 'Understory engine is not ready' };
        }

        const absPath = this.app.vault.adapter.getFullPath(file.path);
        const graphifyDir = this._engineDir ? this._engineDir() : this.settings.graphifyDir;
        const pythonExe = this._pythonExe ? this._pythonExe() : (this.settings.pythonPath || 'python');
        const cmd = refresh ? 'refresh-link' : 'auto-link';
        const presentationMode = this.settings.presentationMode || DEFAULT_SETTINGS.presentationMode || 'sidebar';
        const shouldWriteBody = presentationMode === 'body' || presentationMode === 'both';
        const args = [
            this._enginePath ? this._enginePath('api.py') : `${graphifyDir}/api.py`,
            cmd,
            absPath,
            shouldWriteBody ? '--auto-write' : '--no-auto-write'
        ];
        const vaultBase = this._vaultBasePath ? this._vaultBasePath() : null;
        if (vaultBase) args.push('--vault', vaultBase);

        console.log(`[Understory] Running: ${pythonExe} api.py ${cmd} "${absPath}" ${shouldWriteBody ? '--auto-write' : '--no-auto-write'}`);

        const proc = spawn(pythonExe, args, {
            cwd: graphifyDir,
            env: this._pythonEnv ? this._pythonEnv() : { ...process.env, PYTHONIOENCODING: 'utf-8' },
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let processed = false;
        let outputOverflowed = false;

        const processResultOnce = async (code, stdoutValue, stderrValue, stdoutEnded, stderrEnded) => {
            if (processed) return;
            if (code === null || !stdoutEnded || !stderrEnded) return;
            processed = true;
            await this._maybeProcessResult(file, code, stdoutValue, stderrValue, stdoutEnded, stderrEnded);
        };

        const appendWithLimit = (current, chunk) => {
            const next = current + chunk;
            if (next.length <= MAX_PROCESS_OUTPUT_BYTES) {
                return next;
            }
            outputOverflowed = true;
            return next.slice(0, MAX_PROCESS_OUTPUT_BYTES);
        };

        const stdoutDone = new Promise((resolve) => {
            if (!proc.stdout) {
                resolve();
                return;
            }
            proc.stdout.on('data', (data) => {
                stdout = appendWithLimit(stdout, data.toString());
                if (outputOverflowed && !proc.killed) {
                    proc.kill();
                }
            });
            proc.stdout.on('end', resolve);
        });

        const stderrDone = new Promise((resolve) => {
            if (!proc.stderr) {
                resolve();
                return;
            }
            proc.stderr.on('data', (data) => {
                stderr = appendWithLimit(stderr, data.toString());
                if (outputOverflowed && !proc.killed) {
                    proc.kill();
                }
            });
            proc.stderr.on('end', resolve);
        });

        const exitCode = await new Promise((resolve, reject) => {
            proc.on('error', reject);
            proc.on('close', resolve);
        });

        await Promise.all([stdoutDone, stderrDone]);
        this.timers.delete(file.path);
        if (outputOverflowed) {
            const overflowMessage = `Process output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes and was terminated.`;
            stderr = stderr ? `${stderr}\n${overflowMessage}` : overflowMessage;
        }
        await processResultOnce(exitCode, stdout, stderr, true, true);
        if (exitCode === 0 && !shouldWriteBody && this.relationsStore && this.relationsStore.stripAutoRelatedSection) {
            try {
                await this.relationsStore.stripAutoRelatedSection(file);
            } catch (error) {
                console.error('[Understory] Failed to strip auto-related section:', error);
            }
        }
        return { code: exitCode, stdout, stderr };
    }

    async runGraphify(file, refresh = false) {
        if (!file) return this.runQueue;
        if (this.queuedPaths.has(file.path)) {
            return this.queuedTasks.get(file.path) || this.runQueue;
        }

        this.queuedPaths.add(file.path);

        const task = this.runQueue.then(async () => {
            this.isRunning = true;
            try {
                return await this._runGraphifyProcess(file, refresh);
            } finally {
                this.isRunning = false;
                this.queuedPaths.delete(file.path);
                this.queuedTasks.delete(file.path);
            }
        });

        this.queuedTasks.set(file.path, task);

        this.runQueue = task.catch((error) => {
            console.error('[Understory] Queue worker failed:', error);
        });

        return task;
    }

    async initIndex() {
        if (this._ensureEngineReady && !(await this._ensureEngineReady(true))) return;
        if (!this._runEngineApi) {
            new Notice(t(this, 'index_init_failed', { message: t(this, 'embedding_status_failed_desc') }));
            return;
        }

        new Notice(t(this, 'index_init_started'));

        const args = ['init'];
        const base = this._vaultBasePath ? this._vaultBasePath() : null;
        if (base) args.push('--vault', base);

        try {
            const { payload } = await this._runEngineApi(args, 10 * 60 * 1000);
            const result = payload && typeof payload === 'object'
                ? payload
                : { status: 'error', indexing: 'failed', message: t(this, 'embedding_status_failed_desc') };
            if (this.checkEmbeddingHealth) {
                await this.checkEmbeddingHealth(false, true);
            }

            if (result.status === 'ok' && result.indexing === 'skipped') {
                new Notice(t(this, 'index_init_skipped'));
                return;
            }
            if (result.status === 'ok' && result.indexing === 'complete') {
                new Notice(t(this, 'index_init_done'));
                return;
            }
            if (result.indexing === 'unavailable') {
                new Notice(t(this, 'index_init_unavailable', { message: result.message || '' }), 10000);
                return;
            }
            new Notice(t(this, 'index_init_failed', { message: result.message || result.indexing || 'unknown' }), 10000);
        } catch (error) {
            const message = String(error?.message || error).slice(0, 180);
            if (this.checkEmbeddingHealth) {
                await this.checkEmbeddingHealth(false, true);
            }
            new Notice(t(this, 'index_init_failed', { message }), 10000);
        }
    }

    async startDaemon() {
        if (this.daemonProcess) {
            new Notice(t(this, 'daemon_already_running'));
            return;
        }

        const base = this._vaultBasePath();
        if (!base) {
            new Notice(t(this, 'daemon_no_vault'));
            return;
        }

        const fs = require('fs');
        const { spawn } = require('child_process');
        if (this._ensureEngineReady && !(await this._ensureEngineReady(true))) return;
        const graphifyDir = this._engineDir ? this._engineDir() : this.settings.graphifyDir;
        const pythonExe = this._pythonExe ? this._pythonExe() : (this.settings.pythonPath || 'python');
        const interval = parseInt(this.settings.daemonInterval, 10) || 1800;
        const scriptPath = this._enginePath ? this._enginePath('scripts', 'index_daemon.py') : `${graphifyDir}/scripts/index_daemon.py`;

        if (!fs.existsSync(scriptPath)) {
            new Notice(t(this, 'daemon_script_missing'));
            console.error('[Understory] index daemon script missing:', scriptPath);
            return;
        }

        const proc = spawn(pythonExe, [
            scriptPath,
            '--vault',
            base,
            '--interval',
            String(interval),
        ], {
            cwd: graphifyDir,
            env: this._pythonEnv ? this._pythonEnv() : { ...process.env, PYTHONIOENCODING: 'utf-8' },
            windowsHide: true,
        });

        this.daemonProcess = proc;

        proc.stdout?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.log(`[Understory daemon] ${msg}`);
        });
        proc.stderr?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.error(`[Understory daemon] ${msg}`);
        });
        proc.on('error', (error) => {
            this.daemonProcess = null;
            console.error('[Understory] Failed to start daemon:', error);
            new Notice(t(this, 'daemon_start_failed', { message: error.message }));
        });
        proc.on('close', (code) => {
            this.daemonProcess = null;
            console.log(`[Understory] Index daemon exited with code ${code}`);
            if (this.settings.daemonEnabled && code !== 0) {
                new Notice(t(this, 'daemon_exited', { code }));
            }
        });

        new Notice(t(this, 'daemon_started', { interval }));
    }

    stopDaemon(showNotice = true) {
        if (!this.daemonProcess) {
            if (showNotice) new Notice(t(this, 'daemon_not_running_notice'));
            return;
        }

        const proc = this.daemonProcess;
        this.daemonProcess = null;
        try {
            proc.kill();
            if (showNotice) new Notice(t(this, 'daemon_stopped_notice'));
        } catch (error) {
            console.error('[Understory] Failed to stop daemon:', error);
            if (showNotice) new Notice(t(this, 'daemon_stop_failed', { message: error.message }));
        }
    }

    async toggleDaemon() {
        if (this.daemonProcess) {
            this.stopDaemon();
            this.settings.daemonEnabled = false;
        } else {
            this.settings.daemonEnabled = true;
            await this.startDaemon();
            if (!this.daemonProcess) {
                this.settings.daemonEnabled = false;
            }
        }
        await this.saveSettings();
    }

    async _checkDaemonStatus() {
        return !!(this.daemonProcess && !this.daemonProcess.killed);
    }

    async loadSettings() {
        const data = await this.loadData() || {};
        this._loadedSettingsData = data;
        this.settings = normalizeSettings(data, DEFAULT_SETTINGS);
        if (!this.settings.graphifyDir) this.settings.graphifyDir = getDefaultEngineDir();
        if (!this.settings.pythonPath) this.settings.pythonPath = getDefaultPythonPath();
        const pythonRepair = repairPythonPath(this.settings);
        if (pythonRepair.changed) await this.saveSettings();
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // ═══════════════════════════════════════════
    // AIC-2104/2105/2106: 持续自动更新相关方法
    // ═══════════════════════════════════════════

    /**
     * Promise 版本的 runGraphify，用于水流式队列
     */
    async runGraphifyAsync(file, refresh = false) {
        return this.runGraphify(file, refresh);
    }

    /**
     * AIC-2105: 获取白名单文件夹下的所有可刷新文件
     */
    /**
     * 检查文件路径是否在黑名单中（或其子孙路径）
     */
    _isPathExcluded(filePath) {
        const excluded = this.settings.excludedFolders || [];
        if (excluded.length === 0) return false;
        const normalizedPath = (filePath || '').replace(/\\/g, '/');
        return excluded.some(folder => {
            const normalizedFolder = String(folder || '').replace(/\\/g, '/');
            const folderPrefix = normalizedFolder.endsWith('/') ? normalizedFolder : `${normalizedFolder}/`;
            return normalizedPath.startsWith(folderPrefix) || normalizedPath === folderPrefix.slice(0, -1);
        });
    }

    getRefreshableFiles() {
        const allFiles = this.app.vault.getMarkdownFiles();
        const folders = this.settings.refreshFolders || [];

        let candidates;
        if (folders.length === 0) {
            // 白名单为空 = 全部文件（向后兼容）
            candidates = allFiles;
        } else {
            candidates = allFiles.filter(file => {
                const filePath = file.path;
                return folders.some(folder => {
                    // 匹配逻辑：文件路径以 folder/ 开头，或文件就在 folder 根目录下
                    if (!folder.endsWith('/')) folder += '/';
                    return filePath.startsWith(folder);
                });
            });
        }

        // 再过滤掉黑名单中的文件
        return candidates.filter(file => !this._isPathExcluded(file.path));
    }

    /**
     * AIC-2104/2106: 启动时检查是否需要自动刷新
     */
    async checkAndStartRefresh() {
        if (!this.settings.autoRefreshEnabled) return;
        if (this.settings.refreshInProgress) return;

        const now = Date.now();
        const last = this.settings.lastRefreshTime || 0;
        const freq = this.settings.refreshFrequency; // 'weekly' | 'monthly'

        const msPerDay = 24 * 60 * 60 * 1000;
        const threshold = freq === 'monthly' ? 30 * msPerDay : 7 * msPerDay;

        // 方案C: 首次安装/重置后，不要立即全量刷新，而是把当前时间设为基准
        if (last === 0) {
            this.settings.lastRefreshTime = now;
            await this.saveSettings();
            const days = Math.ceil(threshold / msPerDay);
            console.log(`[Understory] First install / reset detected. Auto-refresh scheduled in ${days} days.`);
            new Notice(t(this, 'auto_refresh_first_enabled', { days }));
            return;
        }

        if (now - last > threshold) {
            console.log(`[Understory] Auto-refresh threshold exceeded (${freq}), starting refresh...`);
            await this.startRefreshQueue();
        } else {
            const daysLeft = Math.ceil((threshold - (now - last)) / msPerDay);
            console.log(`[Understory] Auto-refresh not needed, ${daysLeft} days left`);
        }
    }

    /**
     * AIC-2106: 手动触发全量刷新（命令或按钮调用）
     */
    async startRefreshQueue() {
        if (this.settings.refreshInProgress) {
            new Notice(t(this, 'refresh_already_running_notice'));
            return;
        }

        const files = this.getRefreshableFiles();
        if (files.length === 0) {
            new Notice(t(this, 'refresh_no_files_notice'));
            return;
        }

        this.settings.refreshInProgress = true;
        this.settings.refreshQueue = files.map(f => f.path);
        this.settings.refreshQueueIndex = 0;
        await this.saveSettings();

        new Notice(t(this, 'refresh_started_notice', { count: files.length }));
        this.processNextInQueue();
    }

    /**
     * AIC-2107 基础版: 水流式逐个处理队列
     */
    async processNextInQueue() {
        const queue = this.settings.refreshQueue || [];
        const idx = this.settings.refreshQueueIndex || 0;

        if (idx >= queue.length) {
            // 队列完成
            this.settings.refreshInProgress = false;
            this.settings.lastRefreshTime = Date.now();
            this.settings.refreshQueue = [];
            this.settings.refreshQueueIndex = 0;
            this.refreshTimer = null;
            await this.saveSettings();
            new Notice(t(this, 'refresh_done_notice', { count: queue.length }));
            console.log(`[Understory] Refresh queue completed: ${queue.length} files`);
            return;
        }

        const path = queue[idx];
        const file = this.app.vault.getAbstractFileByPath(path);

        if (file instanceof TFile) {
            console.log(`[Understory] Refreshing [${idx + 1}/${queue.length}]: ${path}`);
            await this.runGraphifyAsync(file, true);
        }

        this.settings.refreshQueueIndex = idx + 1;
        await this.saveSettings();

        // 水流式间隔：每篇之间 5 秒，避免高并发
        this.refreshTimer = setTimeout(() => this.processNextInQueue(), 5000);
    }

    /**
     * 取消当前刷新
     */
    async cancelRefresh() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.settings.refreshInProgress = false;
        this.settings.refreshQueue = [];
        this.settings.refreshQueueIndex = 0;
        await this.saveSettings();
        new Notice(t(this, 'refresh_cancelled_notice'));
    }

    onunload() {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.queuedPaths.clear();
        this.queuedTasks.clear();
        this.runQueue = Promise.resolve();
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        // Graphify AI 层清理
        if (this.ingestTimers) {
            for (const timer of this.ingestTimers.values()) clearTimeout(timer);
            this.ingestTimers.clear();
        }
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = null;
        }
        this.stopDaemon(false);
    }
}

module.exports = LinkDiscoveryMethods.prototype;
