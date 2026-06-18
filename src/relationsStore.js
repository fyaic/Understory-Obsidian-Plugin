const crypto = require('crypto');
const { Notice, TFile } = require('obsidian');
const { MAX_PROCESS_OUTPUT_BYTES } = require('./utils');
const { t } = require('./i18n');

const RELATIONS_PATH = '.understory/relations.json';
const OVERRIDES_PATH = '.understory/link_overrides.json';

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
        return { version: 1, indexedAt: new Date().toISOString(), files: {} };
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
        if (!data.version) data.version = 1;
        return data;
    }

    async _writeStore(data) {
        data.indexedAt = new Date().toISOString();
        await this._writeJson(RELATIONS_PATH, data);
    }

    _hash(content) {
        return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex').slice(0, 16);
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
        }).filter((relation) => relation.target && relation.title);
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
        const store = await this._readStore();
        const indexedAt = new Date().toISOString();
        store.files[this._normalizePath(file.path)] = {
            hash: snapshot.hash,
            mtime: snapshot.mtime,
            indexedAt,
            relations,
        };
        await this._writeStore(store);
        this.app.workspace.trigger('understory:relations-updated', file.path);
        return store.files[this._normalizePath(file.path)];
    }

    async getRelations(fileOrPath) {
        const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath && fileOrPath.path;
        const normalized = this._normalizePath(path);
        const store = await this._readStore();
        const entry = store.files[normalized] || null;
        const file = fileOrPath instanceof TFile
            ? fileOrPath
            : this.app.vault.getAbstractFileByPath(normalized);
        if (!entry) {
            return { status: 'missing', stale: true, relations: [], entry: null };
        }
        if (file instanceof TFile) {
            const snapshot = await this._snapshot(file);
            const stale = entry.hash !== snapshot.hash || Number(entry.mtime || 0) !== Number(snapshot.mtime || 0);
            return { status: 'ok', stale, relations: entry.relations || [], entry };
        }
        return { status: 'ok', stale: false, relations: entry.relations || [], entry };
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
        const result = await this._runNoWriteDiscovery(file, refresh);
        await this.updateFromResult(file, result);
        return result;
    }

    async _runNoWriteDiscovery(file, refresh) {
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
                    reject(new Error(stderr.slice(0, 300) || `api.py exited with code ${code}`));
                    return;
                }
                try {
                    resolve(this._parseProcessJson(stdout));
                } catch (error) {
                    const detail = stderr ? ` stderr: ${stderr.slice(0, 200)}` : '';
                    reject(new Error(`Failed to parse api.py JSON: ${stdout.slice(0, 200)}${detail}`));
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

    async insertRelationIntoBody(file, relation) {
        if (!(file instanceof TFile) || !relation) return false;
        const link = `[[${relation.title}]]`;
        let content = await this.app.vault.read(file);
        if (content.includes(link)) {
            new Notice(t(this.plugin, 'insert_duplicate_notice'));
            return false;
        }
        const anchor = '## 🏷️关联文件';
        const idx = content.indexOf(anchor);
        if (idx === -1) {
            content = `${content.replace(/\s+$/, '')}\n\n${anchor}\n\n${t(this.plugin, 'manual_insert_heading')}\n\n${link}\n`;
        } else {
            const after = content.slice(idx + anchor.length);
            const nextHeading = after.search(/\n## /);
            if (nextHeading === -1) {
                content = `${content.replace(/\s+$/, '')}\n${link}\n`;
            } else {
                const insertAt = idx + anchor.length + nextHeading;
                content = `${content.slice(0, insertAt).replace(/\s+$/, '')}\n${link}\n${content.slice(insertAt)}`;
            }
        }
        await this.app.vault.modify(file, content);
        await this.accept(file.path, relation.title);
        return true;
    }
}

module.exports = { RelationsStore, RELATIONS_PATH, OVERRIDES_PATH };
