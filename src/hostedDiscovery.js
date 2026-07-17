const { Modal, Notice, TFile } = require('obsidian');
const { t } = require('./i18n');

const HOSTED_CANDIDATE_LIMIT = 40;
const HOSTED_SOURCE_SNIPPET_CHARS = 4000;
const HOSTED_CANDIDATE_SNIPPET_CHARS = 2000;

class HostedSnippetConsentModal extends Modal {
    constructor(app, plugin, resolve) {
        super(app);
        this.plugin = plugin;
        this.resolveConsent = resolve;
        this.settled = false;
    }

    _finish(value) {
        if (this.settled) return;
        this.settled = true;
        this.resolveConsent(value);
        this.close();
    }

    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass?.('understory-consent-modal');
        titleEl.setText(t(this.plugin, 'hosted_consent_modal_title'));
        contentEl.createEl('p', { text: t(this.plugin, 'hosted_consent_modal_desc') });
        const notice = this.plugin.settings?.hostedRuntimeConfig?.consent?.notice;
        if (notice) contentEl.createEl('p', { text: notice, cls: 'setting-item-description' });
        contentEl.createEl('p', { text: t(this.plugin, 'hosted_consent_modal_storage'), cls: 'setting-item-description' });
        const actions = contentEl.createDiv({ cls: 'understory-consent-actions' });
        const cancel = actions.createEl('button', { text: t(this.plugin, 'hosted_consent_cancel') });
        cancel.type = 'button';
        cancel.addEventListener('click', () => this._finish(false));
        const allow = actions.createEl('button', { text: t(this.plugin, 'hosted_consent_allow'), cls: 'mod-cta' });
        allow.type = 'button';
        allow.addEventListener('click', () => this._finish(true));
    }

    onClose() {
        if (!this.settled) {
            this.settled = true;
            this.resolveConsent(false);
        }
        this.contentEl.empty();
    }
}

class HostedDiscoveryMethods {
    _hostedDiscoveryError(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    _shouldUseHostedDiscovery() {
        return (this.settings?.networkMode || 'hosted') === 'hosted';
    }

    async ensureHostedSnippetConsent(interactive = true) {
        if (this.settings?.hostedConsentAccepted) return true;
        if (!interactive) return false;
        if (this._hostedConsentPrompt) return this._hostedConsentPrompt;
        this._hostedConsentPrompt = new Promise((resolve) => {
            new HostedSnippetConsentModal(this.app, this, resolve).open();
        }).then(async (accepted) => {
            if (accepted) {
                this.settings.hostedConsentAccepted = true;
                await this.saveSettings();
                new Notice(t(this, 'hosted_consent_saved'));
            }
            return accepted;
        }).finally(() => {
            this._hostedConsentPrompt = null;
        });
        return this._hostedConsentPrompt;
    }

    _hostedSnippet(content, maxChars) {
        return String(content || '')
            .replace(/^---\s*[\s\S]*?\n---\s*/u, '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxChars);
    }

    _hostedLexicalTokens(text) {
        const normalized = String(text || '').toLowerCase();
        const tokens = new Set();
        for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g)) {
            const value = match[0];
            tokens.add(value);
            if (/^[\u3400-\u9fff]+$/.test(value) && value.length > 2) {
                for (let index = 0; index < value.length - 1; index += 1) {
                    tokens.add(value.slice(index, index + 2));
                }
            }
            if (tokens.size >= 80) break;
        }
        return [...tokens];
    }

    _hostedLinkedPaths(file) {
        const direct = new Set();
        const backlinks = new Set();
        const cache = this.app.metadataCache?.getFileCache?.(file);
        for (const link of cache?.links || []) {
            const target = this.app.metadataCache?.getFirstLinkpathDest?.(link.link, file.path);
            if (target instanceof TFile) direct.add(target.path);
        }
        const resolved = this.app.metadataCache?.resolvedLinks || {};
        for (const [sourcePath, targets] of Object.entries(resolved)) {
            if (targets && Number(targets[file.path] || 0) > 0) backlinks.add(sourcePath);
        }
        return { direct, backlinks };
    }

    _rankHostedCandidateFiles(file, sourceContent) {
        const files = this.getRefreshableFiles
            ? this.getRefreshableFiles()
            : this.app.vault.getMarkdownFiles();
        const tokens = this._hostedLexicalTokens(`${file.basename || ''} ${file.path || ''} ${sourceContent.slice(0, 1600)}`);
        const { direct, backlinks } = this._hostedLinkedPaths(file);
        const now = Date.now();
        return files
            .filter((candidate) => candidate instanceof TFile && candidate.path !== file.path)
            .map((candidate) => {
                const searchable = `${candidate.basename || ''} ${candidate.path || ''}`.toLowerCase();
                let score = direct.has(candidate.path) ? 120 : 0;
                if (backlinks.has(candidate.path)) score += 100;
                for (const token of tokens) {
                    if (searchable.includes(token)) score += Math.min(12, Math.max(2, token.length));
                }
                const ageDays = Math.max(0, (now - Number(candidate.stat?.mtime || 0)) / (24 * 60 * 60 * 1000));
                score += Math.max(0, 14 - ageDays) * 0.08;
                return { file: candidate, score };
            })
            .sort((left, right) => right.score - left.score
                || Number(right.file.stat?.mtime || 0) - Number(left.file.stat?.mtime || 0)
                || left.file.path.localeCompare(right.file.path))
            .slice(0, HOSTED_CANDIDATE_LIMIT)
            .map((item) => item.file);
    }

    async _collectHostedDiscoveryPayload(file) {
        const read = this.app.vault.cachedRead
            ? (target) => this.app.vault.cachedRead(target)
            : (target) => this.app.vault.read(target);
        const sourceContent = await read(file);
        const sourceSnippet = this._hostedSnippet(sourceContent, HOSTED_SOURCE_SNIPPET_CHARS);
        if (sourceSnippet.length < 10) {
            throw this._hostedDiscoveryError('hosted_content_too_short', t(this, 'hosted_discovery_content_short'));
        }
        const ranked = this._rankHostedCandidateFiles(file, sourceContent);
        const candidates = (await Promise.all(ranked.map(async (candidate) => {
            try {
                const content = await read(candidate);
                const snippet = this._hostedSnippet(content, HOSTED_CANDIDATE_SNIPPET_CHARS);
                if (snippet.length < 10) return null;
                return {
                    path: candidate.path,
                    title: candidate.basename || candidate.name || candidate.path,
                    snippet,
                };
            } catch (error) {
                return null;
            }
        }))).filter(Boolean);
        return {
            source: {
                path: file.path,
                title: file.basename || file.name || file.path,
                snippet: sourceSnippet,
            },
            candidates,
        };
    }

    _sanitizeHostedDiscoveryResult(body, allowedPaths, sourcePath) {
        const relations = (Array.isArray(body?.relations) ? body.relations : [])
            .filter((item) => item && allowedPaths.has(String(item.target || '')))
            .map((item) => ({
                target: String(item.target),
                title: String(item.title || item.target).slice(0, 200),
                type: 'semantic',
                score: Math.max(0, Math.min(1, Number(item.score || 0))),
                group: String(item.group || 'Vault').slice(0, 120),
                source: 'hosted',
                status: 'suggested',
            }));
        const risks = (Array.isArray(body?.risks) ? body.risks : [])
            .filter((item) => item && allowedPaths.has(String(item.candidate_path || '')))
            .map((item) => ({
                candidate_path: String(item.candidate_path),
                doc_a: sourcePath,
                doc_b: String(item.candidate_path),
                type: String(item.type || 'possible_conflict'),
                severity: ['high', 'medium', 'low'].includes(item.severity) ? item.severity : 'low',
                description: String(item.description || '').slice(0, 500),
                suggestion: String(item.suggestion || '').slice(0, 500),
                status: 'open',
                source: 'hosted',
            }))
            .filter((item) => item.description);
        return {
            status: 'ok',
            network_mode: 'hosted',
            recall_mode: 'hosted-embedding',
            path: sourcePath,
            relations_count: relations.length,
            relations,
            grouped: {},
            risks,
            risk_analysis_status: ['complete', 'skipped', 'unavailable'].includes(body?.risk_analysis_status)
                ? body.risk_analysis_status
                : 'unavailable',
        };
    }

    async hostedDiscoverRelations(file, options = {}) {
        if (!(file instanceof TFile)) return null;
        const interactive = options.interactiveConsent !== false;
        if (!this._hostedAccessToken?.()) {
            if (!interactive) {
                return {
                    status: 'skipped',
                    reason: 'hosted_login_required',
                    path: file.path,
                    relations_count: 0,
                    relations: [],
                    risks: [],
                };
            }
            throw this._hostedDiscoveryError('hosted_login_required', t(this, 'hosted_discovery_login_required'));
        }
        const consent = await this.ensureHostedSnippetConsent(interactive);
        if (!consent) {
            return {
                status: 'skipped',
                reason: t(this, 'hosted_discovery_consent_required'),
                path: file.path,
                relations_count: 0,
                relations: [],
                risks: [],
            };
        }
        const payload = await this._collectHostedDiscoveryPayload(file);
        if (!payload.candidates.length) {
            return {
                status: 'ok',
                network_mode: 'hosted',
                recall_mode: 'hosted-embedding',
                path: file.path,
                candidate_count: 0,
                relations_count: 0,
                relations: [],
                grouped: {},
                risks: [],
                risk_analysis_status: 'skipped',
            };
        }
        const token = this._hostedAccessToken();
        let body;
        try {
            body = await this._hostedFetch('/v1/relations/discover', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    consent: 'selected_snippets',
                    source: payload.source,
                    candidates: payload.candidates,
                    limit: 10,
                    include_risks: this.settings.sidebarShowConflicts !== false,
                }),
            });
        } catch (error) {
            if (Number(error?.status || 0) === 401 && this._clearHostedLocalSession) {
                this._clearHostedLocalSession();
                await this.saveSettings();
                this.refreshHostedAccountSurfaces?.();
            }
            throw error;
        }
        const allowedPaths = new Set(payload.candidates.map((candidate) => candidate.path));
        return this._sanitizeHostedDiscoveryResult(body, allowedPaths, file.path);
    }
}

module.exports = HostedDiscoveryMethods.prototype;
module.exports.HostedSnippetConsentModal = HostedSnippetConsentModal;
module.exports.HOSTED_CANDIDATE_LIMIT = HOSTED_CANDIDATE_LIMIT;
