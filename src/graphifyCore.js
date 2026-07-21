/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const { Notice, TFile } = require('obsidian');
const { t } = require('./i18n');
const { canUseWebhook, recordBackgroundError } = require('./safety');

class GraphifyCoreMethods {
    _vaultBasePath() {
        try {
            return this.app.vault.adapter.getBasePath();
        } catch {
            return null;
        }
    }

    _graphifyScript(name) {
        const base = this._vaultBasePath();
        return base ? `${base}/.understory/scripts/${name}` : null;
    }

    _initGraphifyAI() {
        if ((this.settings?.networkMode || 'hosted') === 'hosted') return;
        // 1. \u547d\u4ee4\uff1a\u624b\u52a8\u89e6\u53d1\uff08\u7eaf UI \u6ce8\u518c\uff0c\u65e0 IO\uff09
        this.addCommand({
            id: 'graphify-ingest-now',
            name: t(this, 'command_ingest_now'),
            callback: () => {
                const file = this.app.workspace.getActiveFile();
                if (file && file.extension === 'md') this.runIngest(file, true);
                else new Notice(t(this, 'sidebar_need_markdown'));
            },
        });
        this.addCommand({
            id: 'graphify-lint-now',
            name: t(this, 'command_lint_now'),
            callback: () => this.runLintAndGraph(true),
        });
        this.addCommand({
            id: 'graphify-open-index',
            name: t(this, 'command_open_index'),
            callback: () => this._openGraphifyIndex(),
        });
        this.addCommand({
            id: 'graphify-view-conflicts',
            name: t(this, 'command_view_conflicts'),
            callback: () => this._openConflictsView(),
        });
        this.addCommand({
            id: 'graphify-view-orphans',
            name: t(this, 'command_view_orphans'),
            callback: () => this._openOrphansView(),
        });

        // 2. \u4e8b\u4ef6\uff1a\u7b49 workspace ready \u540e\u518d\u76d1\u542c vault create/modify\uff0c\u907f\u514d\u51b7\u542f\u52a8\u65f6\u54cd\u5e94\u521d\u59cb\u626b\u63cf\u4e8b\u4ef6
        this._runWhenWorkspaceReady(() => {
            this.registerEvent(this.app.vault.on('create', (file) => {
                if (file && file.extension === 'md' && this.settings.ingestEnabled) {
                    this.scheduleIngest(file);
                }
            }));
            this.registerEvent(this.app.vault.on('modify', (file) => {
                if (file && file.extension === 'md' && this.settings.ingestEnabled) {
                    this.scheduleIngest(file);
                }
            }));

            // 3. \u51b7\u542f\u52a8\u53cb\u597d\uff1a\u5ef6\u8fdf 5s \u68c0\u67e5 .understory \u9aa8\u67b6\uff0c\u518d\u5ef6\u8fdf 60s \u542f\u52a8\u5b9a\u65f6\u5668
            window.setTimeout(() => this._lazyInitGraphify(), 5000);
        });
    }

    async _lazyInitGraphify() {
        const base = this._vaultBasePath();
        if (!base) return;
        const fs = require('fs');
        const graphifyDir = `${base}/.understory`;
        const scriptsDir = `${graphifyDir}/scripts`;
        try {
            if (!fs.existsSync(scriptsDir)) {
                if (this._ensureEngineReady && !(await this._ensureEngineReady(false))) {
                    return;
                }
                // \u90e8\u7f72\u9aa8\u67b6\uff1a\u8c03\u7528 kg \u7684 deploy_graphify.py
                try {
                    await this._runPythonScript(
                        this._enginePath ? this._enginePath('scripts', 'deploy_graphify.py') : `${this.settings.graphifyDir}/scripts/deploy_graphify.py`,
                        ['--vault', base]
                    );
                } catch (error) {
                    recordBackgroundError(this, 'deploy-local-engine', error);
                    return;
                }
                if (!this.settings.graphifyInitialized && this.settings.notificationLevel !== 'silent') {
                    new Notice(t(this, 'graphify_initialized_notice'), 8000);
                }
                this.settings.graphifyInitialized = true;
                await this.saveSettings();
            }
        } catch (error) {
            recordBackgroundError(this, 'initialize-local-engine', error);
        }
        // \u542f\u52a8\u5468\u671f\u68c0\u67e5\u5668\uff08\u5ef6\u8fdf 60s\uff0c\u907f\u514d\u4e0e\u51b7\u542f\u52a8\u4e89\u62a2\uff09
        window.setTimeout(() => {
            this.periodicTimer = window.setInterval(() => {
                if (this.settings.lintEnabled) this.checkAndStartLint();
            }, 5 * 60 * 1000);
            this.registerInterval(this.periodicTimer);
        }, 60000);
    }

    scheduleIngest(file) {
        if (!file) return;
        const path = file.path;
        if (this._isPathExcluded(path)) return;
        if (this.ingestTimers.has(path)) return; // \u4e0e scheduleLink \u540c\u6b3e\u9632\u6296\uff1a\u4e0d\u91cd\u7f6e
        const delay = (this.settings.debounceMinutes || 10) * 60 * 1000;
        const timer = window.setTimeout(() => this.runIngest(file), delay);
        this.ingestTimers.set(path, timer);
    }

    async runIngest(file, manual = false) {
        if (!file) return;
        const task = this.runQueue.then(async () => {
            try {
                return await this._runIngestProcess(file, manual);
            } finally {
                this.ingestTimers.delete(file.path);
            }
        });
        this.runQueue = task.catch((error) => {
            recordBackgroundError(this, 'ingest-queue', error);
        });
        return task;
    }

    async _runIngestProcess(file, manual = false) {
        const base = this._vaultBasePath();
        if (!base) return;
        const absPath = this.app.vault.adapter.getFullPath(file.path);
        const scriptPath = `${base}/.understory/scripts/ingest_principles.py`;
        const fs = require('fs');
        if (!fs.existsSync(scriptPath)) {
            await this._lazyInitGraphify();
            if (!fs.existsSync(scriptPath)) {
                return;
            }
        }
        try {
            await this._runPythonScript(scriptPath, [absPath, '--vault', base]);
            if (manual) new Notice(t(this, 'ingest_done_notice'), 3000);
        } catch (error) {
            recordBackgroundError(this, 'ingest-note', error);
            if (manual) new Notice(t(this, 'ingest_failed_notice'), 5000);
            // \u81ea\u52a8\u89e6\u53d1\u7684\u5931\u8d25\u53ea\u5199\u65e5\u5fd7\uff0c\u4e0d\u6253\u6270\u7528\u6237
        }
    }

    async checkAndStartLint() {
        if (!this.settings.lintEnabled) return;
        if (this.settings.lintInProgress) return;
        const now = Date.now();
        const last = this.settings.lastLintTime || 0;
        const msPerDay = 24 * 60 * 60 * 1000;
        const threshold = (this.settings.lintFrequency === 'monthly' ? 30 : 7) * msPerDay;
        if (last === 0) {
            this.settings.lastLintTime = now; // \u9996\u6b21\u8bbe\u57fa\u51c6\uff0c\u4e0d\u7acb\u5373\u8dd1
            await this.saveSettings();
            return;
        }
        if (now - last > threshold) {
            await this.runLintAndGraph(false);
        }
    }

    async runLintAndGraph(manual = false) {
        const base = this._vaultBasePath();
        if (!base) return;
        if (this.settings.lintInProgress) {
            if (manual) new Notice(t(this, 'lint_in_progress_notice'));
            return;
        }
        this.settings.lintInProgress = true;
        await this.saveSettings();
        const sdir = `${base}/.understory/scripts`;
        // \u5404\u6b65\u9aa4\u76f8\u4e92\u72ec\u7acb\u3001\u5404\u5e26\u8d85\u65f6\uff1a\u5168\u5e93\u68c0\u67e5\u6162\u6216\u5931\u8d25\u4e5f\u4e0d\u5e94\u62d6\u57ae\u77e5\u8bc6\u7f51\u7edc\u5206\u6790/\u7d22\u5f15\u751f\u6210
        const step = async (script, timeoutMs, label, args = ['--vault', base]) => {
            try {
                await this._runPythonScript(`${sdir}/${script}`, args, timeoutMs);
                return true;
            } catch (error) {
                recordBackgroundError(this, `local-analysis-${label}`, error);
                return false;
            }
        };
        try {
            // \u5168\u5e93\u68c0\u67e5\uff1aLLM \u77db\u76fe\u5224\u5b9a\u5df2\u5728 Python \u7aef\u505a\u65f6\u95f4\u9884\u7b97\uff08\u226445s\uff09\uff0c\u8fd9\u91cc 5 \u5206\u949f\u515c\u5e95\u8d85\u65f6
            try {
                await this._runPythonScript(`${sdir}/lint.py`, ['--vault', base, '--fix'], 5 * 60 * 1000);
            } catch (error) {
                recordBackgroundError(this, 'local-analysis-lint', error);
            }
            // \u77e5\u8bc6\u7f51\u7edc\u5206\u6790 / \u7d22\u5f15 / \u901a\u77e5\uff1a\u5f7c\u6b64\u72ec\u7acb\uff0c\u786e\u4fdd\u5206\u6790\u7d22\u5f15\u603b\u80fd\u751f\u6210
            await step('graph_analyzer.py', 3 * 60 * 1000, 'graph');
            await step('index_generator.py', 60 * 1000, 'index');
            const notifyArgs = ['--vault', base];
            if (canUseWebhook(this.settings)) {
                notifyArgs.push('--webhook', this.settings.webhookUrl);
                notifyArgs.push('--webhook-type', this.settings.webhookType || 'slack');
                notifyArgs.push('--webhook-enabled');
            }
            await step('notification_manager.py', 60 * 1000, 'notify', notifyArgs);
            this.settings.lastLintTime = Date.now();

            const highCount = this._countOpenConflicts('high');
            if (highCount > 0 && this._shouldNotify('high_conflict')) {
                new Notice(t(this, 'high_conflict_notice', { count: highCount }), 10000);
            }
            if (this.settings.conflictBlockEnabled && (this.settings.presentationMode || 'sidebar') !== 'sidebar') {
                try {
                    await this._updateConflictBlocksInVault();
                } catch (error) {
                    recordBackgroundError(this, 'update-conflict-blocks', error);
                }
            }
            if (manual) {
                const total = this._countOpenConflicts();
                new Notice(t(this, 'lint_done_notice', { total, high: highCount }), 5000);
            }
        } finally {
            this.settings.lintInProgress = false;
            await this.saveSettings();
        }
    }

    _shouldNotify(type) {
        const cd = this.settings.notificationCooldown || {};
        const now = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;
        if (type === 'high_conflict') {
            if (!this.settings.notifyHighConflict) return false;
            if (now - (cd.high_conflict || 0) < 7 * msPerDay) return false;
            cd.high_conflict = now;
        } else if (type === 'daily_digest') {
            const today = new Date().toDateString();
            if (cd.daily_digest === today) return false;
            cd.daily_digest = today;
        } else {
            return false;
        }
        this.settings.notificationCooldown = cd;
        this.saveSettings();
        return true;
    }

    _readConflicts() {
        const base = this._vaultBasePath();
        if (!base) return null;
        const fs = require('fs');
        const p = `${base}/.understory/conflicts.json`;
        if (!fs.existsSync(p)) return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        } catch {
            return null;
        }
    }

    _countOpenConflicts(severity) {
        const data = this._readConflicts();
        if (!data || !Array.isArray(data.issues)) return 0;
        return data.issues.filter(i => i.status === 'open'
            && (!severity || i.severity === severity)).length;
    }

    async _updateConflictBlocksInVault() {
        if ((this.settings.presentationMode || 'sidebar') === 'sidebar') return;
        const data = this._readConflicts();
        if (!data || !Array.isArray(data.issues)) return;
        const minSev = this.settings.conflictBlockMinSeverity || 'high';
        const sevRank = { low: 0, medium: 1, high: 2 };
        const threshold = sevRank[minSev] ?? 2;
        // \u6309\u6587\u6863\u805a\u5408\u76f8\u5173\u51b2\u7a81
        const byDoc = new Map();
        for (const it of data.issues) {
            if (it.status !== 'open') continue;
            if ((sevRank[it.severity] ?? 0) < threshold) continue;
            for (const d of [it.doc_a, it.doc_b, it.doc]) {
                if (!d) continue;
                if (!byDoc.has(d)) byDoc.set(d, []);
                byDoc.get(d).push(it);
            }
        }
        for (const [docPath, issues] of byDoc.entries()) {
            const file = this.app.vault.getAbstractFileByPath(docPath);
            if (file instanceof TFile) {
                try {
                    await this._insertConflictBlock(file, issues);
                } catch (error) {
                    recordBackgroundError(this, `update-conflict-block:${docPath}`, error);
                }
            }
        }
    }

    async _insertConflictBlock(file, issues) {
        let content = await this.app.vault.read(file);
        // \u5220\u9664\u65e7\u51b2\u7a81\u533a\u5757\uff08\u951a\u70b9 ## \u26a0\ufe0f\u51b2\u7a81\u53d1\u73b0 \u5230\u4e0b\u4e00\u4e2a ## \u6216\u6587\u672b\uff09
        const anchor = '## \u26a0\ufe0f\u51b2\u7a81\u53d1\u73b0';
        content = this._stripConflictBlock(content, anchor);
        if (!issues || issues.length === 0) {
            await this.app.vault.modify(file, content.replace(/\s+$/, '') + '\n');
            return;
        }
        const sevIcon = { high: '\ud83d\udd34 \u4e25\u91cd', medium: '\ud83d\udfe1 \u4e00\u822c', low: '\ud83d\udfe2 \u8f7b\u5fae' };
        const date = new Date().toISOString().slice(0, 10);
        let block = `\n\n${anchor}\n\n> \u81ea\u52a8\u68c0\u6d4b\u4e8e ${date}\uff08\u5171 ${issues.length} \u9879\uff09\n\n`;
        block += '| \u7c7b\u578b | \u4e25\u91cd\u5ea6 | \u8bf4\u660e | \u5efa\u8bae |\n|------|--------|------|------|\n';
        for (const it of issues.slice(0, 10)) {
            block += `| ${it.type} | ${sevIcon[it.severity] || it.severity} | ${(it.description || '').slice(0, 60)} | ${(it.suggestion || '').slice(0, 40)} |\n`;
        }
        block += '\n> \ud83d\udca1 \u5b8c\u6574\u62a5\u544a\u89c1\u5206\u6790\u7d22\u5f15\uff1a[[.understory/index]]\n';
        await this.app.vault.modify(file, content.replace(/\s+$/, '') + block);
    }

    _stripConflictBlock(content, anchor) {
        const idx = content.indexOf(anchor);
        if (idx === -1) return content;
        const after = content.slice(idx + anchor.length);
        const nextHeading = after.search(/\n## (?!\u26a0)/);
        if (nextHeading === -1) {
            return content.slice(0, idx).replace(/\s+$/, '') + '\n';
        }
        return (content.slice(0, idx).replace(/\s+$/, '') + '\n\n'
            + after.slice(nextHeading + 1));
    }
}

module.exports = GraphifyCoreMethods.prototype;

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
