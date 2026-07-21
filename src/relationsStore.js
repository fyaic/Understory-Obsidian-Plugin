/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const nodeCrypto = require('crypto');
const { Notice, TFile } = require('obsidian');
const { MAX_PROCESS_OUTPUT_BYTES } = require('./utils');
const { t } = require('./i18n');
const { extractProcessJsonMessage, redactSensitiveText, safeErrorDetail } = require('./safety');
const {
    annotateRelations,
    buildRelationDiagnostics,
    buildVaultPathIndex,
} = require('./relationTargetResolution');

const RELATIONS_PATH = '.understory/relations.json';
const OVERRIDES_PATH = '.understory/link_overrides.json';
const INTERNAL_RELATION_TARGET_PREFIXES = ['.understory/', '.trash/'];
const SUGGESTIONS_START = '<!-- understory:suggestions:start -->';
const SUGGESTIONS_END = '<!-- understory:suggestions:end -->';

class RelationsStore {
    constructor(plugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    async _ensureUnderstoryDir() {
        const adapter = this.app.vault.adapter;
        try {
            if (adapter.exists && !(await adapter.exists('.understory'))) {
                await adapter.mkdir('.understory');
            }
        } catch (error) {
            if (!String(error && error.message || error).includes('already exists')) {
                throw error;
            }
        }
    }

    _emptyStore() {
        return { version: 2, indexedAt: new Date().toISOString(), files: {} };
    }

    async _readJson(path, fallback) {
        try {
            const raw = await this.app.vault.adapter.read(path);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    async _writeJson(path, data) {
        await this._ensureUnderstoryDir();
        await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    }

    async _readStore() {
        const data = await this._readJson(RELATIONS_PATH, this._emptyStore());
        if (!data.files || typeof data.files !== 'object') data.files = {};
        data.version = Math.max(2, Number(data.version || 0));
        this._sanitizeStore(data);
        return data;
    }

    async _writeStore(data) {
        data.indexedAt = new Date().toISOString();
        await this._writeJson(RELATIONS_PATH, data);
    }

    _hash(content) {
        return nodeCrypto.createHash('sha256').update(content || '', 'utf8').digest('hex').slice(0, 16);
    }

    async _snapshot(file) {
        const content = await this.app.vault.read(file);
        return {
            hash: this._hash(content),
            mtime: file.stat && file.stat.mtime ? file.stat.mtime : Date.now(),
        };
    }

    _normalizePath(path) {
        return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    }

    _isInternalRelationTarget(target) {
        const normalized = this._normalizePath(target).toLowerCase();
        const firstSegment = normalized.split('/')[0] || '';
        const hiddenTarget = firstSegment.startsWith('.') && firstSegment !== '.' && firstSegment !== '..';
        return hiddenTarget || this._internalRelationTargetPrefixes()
            .some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
    }

    _internalRelationTargetPrefixes() {
        const configDir = this._normalizePath(this.app?.vault?.configDir).replace(/\/+$/, '').toLowerCase();
        return [
            ...(configDir ? [`${configDir}/`] : []),
            ...INTERNAL_RELATION_TARGET_PREFIXES,
        ];
    }

    _sanitizeRelations(relations) {
        if (!Array.isArray(relations)) return [];
        return relations.filter((relation) => relation && relation.target && !this._isInternalRelationTarget(relation.target));
    }

    _sanitizeStore(data) {
        let changed = false;
        for (const entry of Object.values(data.files || {})) {
            if (!entry || !Array.isArray(entry.relations)) continue;
            const sanitized = this._sanitizeRelations(entry.relations);
            if (sanitized.length !== entry.relations.length) {
                entry.relations = sanitized;
                changed = true;
            }
        }
        return changed;
    }


    _buildRelationPathIndex() {
        const vault = this.app && this.app.vault;
        const files = vault && typeof vault.getMarkdownFiles === 'function' ? vault.getMarkdownFiles() : [];
        const paths = files.map((file) => file && file.path).filter(Boolean);
        return buildVaultPathIndex(paths, { internalPrefixes: this._internalRelationTargetPrefixes() });
    }

    _groupMap(grouped) {
        const out = new Map();
        for (const [group, values] of Object.entries(grouped || {})) {
            if (!Array.isArray(values)) continue;
            for (const value of values) {
                if (typeof value === 'string') {
                    out.set(value, group);
                } else if (value && typeof value === 'object') {
                    if (value.title) out.set(value.title, group);
                    if (value.path) out.set(this._normalizePath(value.path), group);
                }
            }
        }
        return out;
    }

    _relationSource(relation) {
        if (relation.source) return relation.source;
        if (Array.isArray(relation.er_relation_types) && relation.er_relation_types.length) return 'er';
        if (relation.reason === 'keyword') return 'keyword';
        return 'embedding';
    }

    _relationType(relation) {
        if (relation.type) return relation.type;
        if (Array.isArray(relation.er_relation_types) && relation.er_relation_types.length) return 'er';
        return 'semantic';
    }

    _normalizeRelations(result) {
        const grouped = this._groupMap(result.grouped || {});
        const now = new Date().toISOString();
        const relations = Array.isArray(result.relations) ? result.relations : [];
        return relations.map((relation) => {
            const target = this._normalizePath(relation.target || relation.path || relation.file || relation.title);
            const title = relation.title || target.split('/').pop().replace(/\.md$/, '') || target;
            return {
                target,
                title,
                type: this._relationType(relation),
                score: Number(relation.score ?? relation.similarity ?? 0),
                group: relation.group || grouped.get(title) || grouped.get(target) || this._relationType(relation),
                status: relation.status || 'suggested',
                source: this._relationSource(relation),
                createdAt: relation.createdAt || now,
                updatedAt: now,
            };
        }).filter((relation) => relation.target && relation.title && !this._isInternalRelationTarget(relation.target));
    }

    _normalizeRisks(result, filePath) {
        const allowedTypes = new Set(['possible_conflict', 'stale_claim', 'duplicate']);
        const allowedSeverities = new Set(['high', 'medium', 'low']);
        return (Array.isArray(result.risks) ? result.risks : [])
            .filter((risk) => risk && allowedTypes.has(risk.type))
            .map((risk) => ({
                candidate_path: this._normalizePath(risk.candidate_path || risk.doc_b),
                doc_a: this._normalizePath(risk.doc_a || filePath),
                doc_b: this._normalizePath(risk.doc_b || risk.candidate_path),
                type: risk.type,
                severity: allowedSeverities.has(risk.severity) ? risk.severity : 'low',
                description: String(risk.description || '').slice(0, 500),
                suggestion: String(risk.suggestion || '').slice(0, 500),
                status: 'open',
                source: risk.source === 'hosted' ? 'hosted' : (risk.source || 'local'),
            }))
            .filter((risk) => risk.candidate_path && risk.description);
    }

    async _readOverrides() {
        const data = await this._readJson(OVERRIDES_PATH, {});
        return data && typeof data === 'object' ? data : {};
    }

    _isTombstoned(tombstone) {
        if (!tombstone || tombstone.action !== 'deleted') return false;
        const ttl = Number(tombstone.ttl_days || 30);
        const at = Date.parse(tombstone.at || '');
        if (!Number.isFinite(at)) return true;
        return Date.now() - at < ttl * 24 * 60 * 60 * 1000;
    }

    async _filterTombstones(filePath, relations) {
        const overrides = await this._readOverrides();
        const doc = overrides[this._normalizePath(filePath)] || {};
        const tombstones = doc.tombstones || {};
        return relations.filter((relation) => !this._isTombstoned(tombstones[relation.title]));
    }

    async updateFromResult(file, result) {
        if (!(file instanceof TFile) || !result || result.status !== 'ok') return null;
        const snapshot = await this._snapshot(file);
        const relations = await this._filterTombstones(file.path, this._normalizeRelations(result));
        const risks = this._normalizeRisks(result, file.path);
        const store = await this._readStore();
        const indexedAt = new Date().toISOString();
        store.files[this._normalizePath(file.path)] = {
            hash: snapshot.hash,
            mtime: snapshot.mtime,
            indexedAt,
            relations,
            risks,
            riskAnalysisStatus: result.risk_analysis_status || 'skipped',
            networkMode: result.network_mode || 'local',
        };
        await this._writeStore(store);
        this.app.workspace.trigger('understory:relations-updated', file.path);
        return store.files[this._normalizePath(file.path)];
    }

    async getRelations(fileOrPath) {
        const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath && fileOrPath.path;
        const normalized = this._normalizePath(path);
        const store = await this._readStore();
        const pathIndex = this._buildRelationPathIndex();
        const entry = store.files[normalized] || null;
        const file = fileOrPath instanceof TFile
            ? fileOrPath
            : this.app.vault.getAbstractFileByPath(normalized);
        if (!entry) {
            return {
                status: 'missing',
                stale: true,
                relations: [],
                risks: [],
                diagnostics: buildRelationDiagnostics([]),
                entry: null,
            };
        }
        const relations = annotateRelations(entry.relations || [], pathIndex, {
            internalPrefixes: this._internalRelationTargetPrefixes(),
        });
        const entryForResponse = { ...entry, relations };
        if (file instanceof TFile) {
            const snapshot = await this._snapshot(file);
            const stale = entry.hash !== snapshot.hash || Number(entry.mtime || 0) !== Number(snapshot.mtime || 0);
            return {
                status: 'ok',
                stale,
                relations,
                risks: entry.risks || [],
                diagnostics: buildRelationDiagnostics(relations),
                entry: entryForResponse,
            };
        }
        return {
            status: 'ok',
            stale: false,
            relations,
            risks: entry.risks || [],
            diagnostics: buildRelationDiagnostics(relations),
            entry: entryForResponse,
        };
    }

    async _updateRelationStatus(filePath, targetTitle, status) {
        const normalized = this._normalizePath(filePath);
        const store = await this._readStore();
        const entry = store.files[normalized];
        if (!entry || !Array.isArray(entry.relations)) return false;
        let changed = false;
        const now = new Date().toISOString();
        for (const relation of entry.relations) {
            if (relation.title === targetTitle || relation.target === targetTitle) {
                relation.status = status;
                relation.updatedAt = now;
                changed = true;
            }
        }
        if (changed) await this._writeStore(store);
        this.app.workspace.trigger('understory:relations-updated', normalized);
        return changed;
    }

    async accept(filePath, targetTitle) {
        return this._updateRelationStatus(filePath, targetTitle, 'accepted');
    }

    async reject(filePath, targetTitle) {
        const normalized = this._normalizePath(filePath);
        const overrides = await this._readOverrides();
        if (!overrides[normalized]) overrides[normalized] = {};
        if (!overrides[normalized].tombstones) overrides[normalized].tombstones = {};
        overrides[normalized].tombstones[targetTitle] = {
            action: 'deleted',
            at: new Date().toISOString(),
            ttl_days: 30,
            target_hash: '',
        };
        await this._writeJson(OVERRIDES_PATH, overrides);
        return this._updateRelationStatus(normalized, targetTitle, 'rejected');
    }

    async discoverAndCache(file, refresh = true) {
        if (!(file instanceof TFile)) return null;
        const hosted = !!this.plugin._shouldUseHostedDiscovery?.();
        try {
            const result = await this._runNoWriteDiscovery(file, refresh);
            await this.updateFromResult(file, result);
            if (hosted) await this._recordHostedActivity(file, result);
            else this._showEngineGuidance(result);
            return result;
        } catch (error) {
            if (hosted) await this._recordHostedActivity(file, null, error);
            throw error;
        }
    }

    async _recordHostedActivity(file, result, error = null) {
        if (typeof this.plugin._addLogEntry !== 'function') return;
        const relations = Array.isArray(result?.relations) ? result.relations : [];
        const titles = relations
            .map((relation) => String(relation?.title || relation?.target || '').trim())
            .filter(Boolean)
            .slice(0, 10);
        const entry = {
            time: typeof this.plugin._formatTime === 'function'
                ? this.plugin._formatTime(new Date())
                : new Date().toISOString(),
            file: file.basename || file.name || file.path,
            filePath: this._normalizePath(file.path),
            status: error ? 'error' : (result?.status || 'ok'),
            count: error ? 0 : relations.length,
            relations: titles,
            source: 'hosted',
        };
        if (error) {
            entry.errorCategory = Number(error?.status || 0) === 401 ? 'session_expired' : 'hosted_request_failed';
            entry.message = 'Hosted analysis request failed.';
        }
        try {
            await this.plugin._addLogEntry(entry);
        } catch (error) {
            this.plugin.hostedActivityLogError = error;
        }
    }

    _showEngineGuidance(result) {
        const fixes = Array.isArray(result?.fixes) ? result.fixes : [];
        const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
        const indexFix = fixes.find((fix) => fix && fix.id === 'embedding_index_missing');
        if (indexFix) {
            new Notice(t(this.plugin, 'embedding_index_missing_notice'), 10000);
            if (this.plugin.checkEmbeddingHealth) {
                this.plugin.checkEmbeddingHealth(false, true).catch(() => undefined);
            }
        }
        if (warnings.length || fixes.length) {
            const detail = JSON.stringify({ warnings, fixes });
            this.plugin.lastEngineGuidance = redactSensitiveText(detail, this.plugin.settings);
        }
    }

    async _runNoWriteDiscovery(file, refresh) {
        if (this.plugin._shouldUseHostedDiscovery?.() && this.plugin.hostedDiscoverRelations) {
            return this.plugin.hostedDiscoverRelations(file, { interactiveConsent: refresh !== false });
        }
        const { spawn } = require('child_process');
        if (this.plugin._ensureEngineReady && !(await this.plugin._ensureEngineReady(true))) {
            throw new Error('Understory engine is not ready');
        }
        const graphifyDir = this.plugin._engineDir ? this.plugin._engineDir() : this.plugin.settings.graphifyDir;
        const pythonExe = this.plugin._pythonExe ? this.plugin._pythonExe() : (this.plugin.settings.pythonPath || 'python');
        const cmd = refresh ? 'refresh-link' : 'auto-link';
        const absPath = this.app.vault.adapter.getFullPath(file.path);
        const args = [this.plugin._enginePath ? this.plugin._enginePath('api.py') : `${graphifyDir}/api.py`, cmd, absPath, '--no-auto-write'];
        const base = this.plugin._vaultBasePath ? this.plugin._vaultBasePath() : null;
        if (base) args.push('--vault', base);

        return new Promise((resolve, reject) => {
            const proc = spawn(pythonExe, args, {
                cwd: graphifyDir,
                env: this.plugin._pythonEnv ? this.plugin._pythonEnv() : { ...process.env, PYTHONIOENCODING: 'utf-8' },
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            let outputOverflowed = false;
            const append = (current, data) => {
                const next = current + data.toString();
                if (next.length <= MAX_PROCESS_OUTPUT_BYTES) return next;
                outputOverflowed = true;
                try { proc.kill(); } catch (error) { /* ignore */ }
                return next.slice(0, MAX_PROCESS_OUTPUT_BYTES);
            };
            proc.stdout?.on('data', (data) => { stdout = append(stdout, data); });
            proc.stderr?.on('data', (data) => { stderr = append(stderr, data); });
            proc.on('error', reject);
            proc.on('close', (code) => {
                if (outputOverflowed) {
                    reject(new Error(`Process output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes.`));
                    return;
                }
                if (code !== 0) {
                    const engineMessage = extractProcessJsonMessage(stdout);
                    reject(new Error(safeErrorDetail({
                        stderr,
                        message: engineMessage
                            ? `api.py exited with code ${code}: ${engineMessage}`
                            : `api.py exited with code ${code}`,
                        settings: this.plugin.settings,
                    })));
                    return;
                }
                try {
                    resolve(this._parseProcessJson(stdout));
                } catch (error) {
                    reject(new Error(`Failed to parse api.py JSON: ${safeErrorDetail({
                        stdout,
                        stderr,
                        settings: this.plugin.settings,
                    })}`));
                }
            });
        });
    }

    _parseProcessJson(stdout) {
        const raw = String(stdout || '').trim();
        if (!raw) throw new Error('Empty stdout');
        try {
            return JSON.parse(raw);
        } catch (firstError) {
            const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i -= 1) {
                const line = lines[i];
                if (!line.startsWith('{') || !line.endsWith('}')) continue;
                try {
                    return JSON.parse(line);
                } catch (error) {
                    // Keep looking for an earlier complete JSON line.
                }
            }
            const start = raw.lastIndexOf('{');
            const end = raw.lastIndexOf('}');
            if (start !== -1 && end > start) {
                return JSON.parse(raw.slice(start, end + 1));
            }
            throw firstError;
        }
    }

    _relationSectionHeadings() {
        return [
            t(this.plugin, 'related_section_heading'),
            '## 🏷️ Related notes',
            '## Related notes',
            '## 🏷️关联文件',
            '## 关联文件',
        ].filter((heading, index, headings) => heading && headings.indexOf(heading) === index);
    }

    _findRelationSection(content) {
        let best = null;
        for (const heading of this._relationSectionHeadings()) {
            const index = content.indexOf(heading);
            if (index !== -1 && (!best || index < best.index)) {
                best = { index, heading };
            }
        }
        return best;
    }

    async insertRelationIntoBody(file, relation) {
        if (!(file instanceof TFile) || !relation) return false;
        const link = `[[${relation.title}]]`;
        let content = await this.app.vault.read(file);
        if (content.includes(link)) {
            new Notice(t(this.plugin, 'insert_duplicate_notice'));
            return false;
        }
        const section = this._findRelationSection(content);
        if (!section) {
            const anchor = t(this.plugin, 'related_section_heading');
            content = `${content.replace(/\s+$/, '')}\n\n${anchor}\n\n${t(this.plugin, 'manual_insert_heading')}\n\n${link}\n`;
        } else {
            const after = content.slice(section.index + section.heading.length);
            const nextHeading = after.search(/\n## /);
            if (nextHeading === -1) {
                content = `${content.replace(/\s+$/, '')}\n${link}\n`;
            } else {
                const insertAt = section.index + section.heading.length + nextHeading;
                content = `${content.slice(0, insertAt).replace(/\s+$/, '')}\n${link}\n${content.slice(insertAt)}`;
            }
        }
        await this.app.vault.modify(file, content);
        await this.accept(file.path, relation.title);
        return true;
    }

    async stripAutoRelatedSection(file) {
        if (!(file instanceof TFile)) return false;
        const SENTINEL = '<!-- auto-links -->';
        let content = await this.app.vault.read(file);
        const section = this._findRelationSection(content);
        if (!section) return false;

        const afterHeading = content.slice(section.index + section.heading.length);
        const nextHeading = afterHeading.search(/\n## /);
        const sectionEnd = nextHeading === -1
            ? content.length
            : section.index + section.heading.length + nextHeading;
        const sectionText = content.slice(section.index, sectionEnd);
        if (!sectionText.includes(SENTINEL)) return false;

        const before = content.slice(0, section.index).replace(/\s+$/, '');
        const after = content.slice(sectionEnd).replace(/^\s+/, '');
        const newContent = before + (after ? `\n\n${after}\n` : '\n');
        if (newContent === content) return false;
        await this.app.vault.modify(file, newContent);
        return true;
    }

    async syncSuggestedRelationsIntoBody(file, relations) {
        if (!(file instanceof TFile)) return false;
        const suggestions = (Array.isArray(relations) ? relations : [])
            .filter((relation) => relation && relation.status !== 'rejected' && relation.target)
            .slice(0, 8);
        const replace = (source) => {
            const content = String(source || '');
            const start = content.indexOf(SUGGESTIONS_START);
            const end = content.indexOf(SUGGESTIONS_END);
            let clean = content;
            if (start >= 0 && end > start) {
                clean = `${content.slice(0, start).replace(/\s+$/, '')}${content.slice(end + SUGGESTIONS_END.length)}`;
            }
            if (!suggestions.length) return `${clean.replace(/\s+$/, '')}\n`;
            const heading = t(this.plugin, 'hosted_body_suggestions_heading');
            const intro = t(this.plugin, 'hosted_body_suggestions_intro');
            const rows = suggestions.map((relation) => {
                const target = String(relation.target).replace(/\.md$/i, '');
                const score = Number.isFinite(Number(relation.score)) ? ` (${Number(relation.score).toFixed(2)})` : '';
                return `- [[${target}]]${score}`;
            });
            const block = `${SUGGESTIONS_START}\n## ${heading}\n\n${intro}\n\n${rows.join('\n')}\n${SUGGESTIONS_END}`;
            return `${clean.replace(/\s+$/, '')}\n\n${block}\n`;
        };
        if (typeof this.app.vault.process === 'function') {
            let changed = false;
            await this.app.vault.process(file, (content) => {
                const next = replace(content);
                changed = next !== content;
                return next;
            });
            return changed;
        }
        const content = await this.app.vault.read(file);
        const next = replace(content);
        if (next === content) return false;
        await this.app.vault.modify(file, next);
        return true;
    }
}

module.exports = { RelationsStore, RELATIONS_PATH, OVERRIDES_PATH, SUGGESTIONS_START, SUGGESTIONS_END };

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
