/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const { Notice, TFile } = require('obsidian');
const { t } = require('./i18n');
const { recordBackgroundError } = require('./safety');

const HOSTED_PRINCIPLES_PATH = '.understory/principles.hosted.json';
const HOSTED_CONFLICTS_PATH = '.understory/conflicts.json';
const HOSTED_INDEX_PATH = '.understory/index.md';
const HOSTED_EMBEDDING_BATCH = 48;
const HOSTED_SEMANTIC_NOTE_LIMIT = 2000;
const HOSTED_REVIEW_PAIR_LIMIT = 24;

class HostedAnalysisMethods {
    async _hostedAnalysisReadJson(path, fallback) {
        try {
            const raw = await this.app.vault.adapter.read(path);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    async _hostedAnalysisWrite(path, value) {
        await this.relationsStore?._ensureUnderstoryDir?.();
        await this.app.vault.adapter.write(path, value);
    }

    _hostedAnalysisFiles() {
        const files = this.getRefreshableFiles ? this.getRefreshableFiles() : this.app.vault.getMarkdownFiles();
        return files.filter((file) => file instanceof TFile).sort((a, b) => a.path.localeCompare(b.path));
    }

    _hostedAnalysisTokens(text) {
        if (this._hostedLexicalTokens) return this._hostedLexicalTokens(text);
        return [...new Set(String(text || '').toLowerCase().match(/[a-z0-9_-]{3,}|[\u3400-\u9fff]{2,}/g) || [])].slice(0, 80);
    }

    async _hostedCollectVaultState() {
        const files = this._hostedAnalysisFiles();
        const filePaths = new Set(files.map((file) => file.path));
        const resolvedLinks = this.app.metadataCache?.resolvedLinks || {};
        const inbound = new Map(files.map((file) => [file.path, 0]));
        for (const targets of Object.values(resolvedLinks)) {
            for (const [target, count] of Object.entries(targets || {})) {
                if (filePaths.has(target)) inbound.set(target, Number(inbound.get(target) || 0) + Number(count || 0));
            }
        }

        const relationStore = await this.relationsStore?._readStore?.() || { files: {} };
        const issues = [];
        const edgeKeys = new Set();
        const documents = [];
        const brokenSeen = new Set();
        for (const file of files) {
            const content = await (this.app.vault.cachedRead ? this.app.vault.cachedRead(file) : this.app.vault.read(file));
            const snippet = this._hostedSnippet ? this._hostedSnippet(content, 1200) : String(content || '').slice(0, 1200);
            const cache = this.app.metadataCache?.getFileCache?.(file) || {};
            let outgoing = 0;
            for (const link of cache.links || []) {
                const target = this.app.metadataCache?.getFirstLinkpathDest?.(link.link, file.path);
                if (target instanceof TFile && filePaths.has(target.path)) {
                    outgoing += 1;
                    edgeKeys.add(`${file.path}\u0000${target.path}`);
                } else {
                    const label = String(link.displayText || link.link || '').trim().slice(0, 200);
                    const key = `${file.path}\u0000${label}`;
                    if (label && !brokenSeen.has(key)) {
                        brokenSeen.add(key);
                        issues.push({
                            type: 'dead_link', severity: 'medium', status: 'open', doc_a: file.path, doc_b: label,
                            description: `Unresolved link: ${label}`, suggestion: 'Update the target or remove the broken link.', source: 'client-structure',
                        });
                    }
                }
            }
            if (outgoing === 0 && Number(inbound.get(file.path) || 0) === 0) {
                issues.push({
                    type: 'orphan_page', severity: 'low', status: 'open', doc: file.path,
                    description: 'This note has no resolved outgoing links or backlinks.', suggestion: 'Add a useful connection or archive the note.', source: 'client-structure',
                });
            }
            const relationEntry = relationStore.files?.[file.path];
            const contentHash = this.relationsStore?._hash?.(content) || '';
            if (relationEntry && relationEntry.hash && relationEntry.hash !== contentHash) {
                issues.push({
                    type: 'stale_claim', severity: 'low', status: 'open', doc: file.path,
                    description: 'Stored relation suggestions predate the current note content.', suggestion: 'Refresh suggestions for this note.', source: 'client-cache',
                });
            }
            for (const relation of relationEntry?.relations || []) {
                if (relation.target && filePaths.has(relation.target) && relation.status !== 'rejected') {
                    edgeKeys.add(`${file.path}\u0000${relation.target}`);
                }
            }
            documents.push({
                file,
                path: file.path,
                title: file.basename || file.name || file.path,
                snippet,
                mtime: Number(file.stat?.mtime || 0),
            });
        }
        return { documents, edgeKeys, issues, inbound };
    }

    async hostedExtractPrinciplesForFile(file = this.app.workspace.getActiveFile(), showNotice = true) {
        if (!(file instanceof TFile)) throw new Error(t(this, 'sidebar_need_markdown'));
        const token = this._hostedAccessToken?.();
        if (!token) throw new Error(t(this, 'hosted_login_required'));
        if (!(await this.ensureHostedSnippetConsent(true))) return null;
        const content = await (this.app.vault.cachedRead ? this.app.vault.cachedRead(file) : this.app.vault.read(file));
        const snippet = this._hostedSnippet(content, 4000);
        if (!snippet) throw new Error(t(this, 'hosted_discovery_content_short'));
        const response = await this._hostedFetch('/v1/principles/extract', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                consent: 'selected_snippet',
                source: { path: file.path, title: file.basename || file.name || file.path, snippet },
                max_items: 8,
            }),
        });
        const store = await this._hostedAnalysisReadJson(HOSTED_PRINCIPLES_PATH, { version: 1, files: {} });
        if (!store.files || typeof store.files !== 'object') store.files = {};
        const principles = Array.isArray(response?.principles) ? response.principles : [];
        store.version = 1;
        store.updated_at = new Date().toISOString();
        store.files[file.path] = {
            content_hash: this.relationsStore?._hash?.(content) || '',
            extracted_at: new Date().toISOString(),
            principles,
        };
        await this._hostedAnalysisWrite(HOSTED_PRINCIPLES_PATH, JSON.stringify(store, null, 2));
        const report = await this._hostedAnalysisReadJson(HOSTED_CONFLICTS_PATH, null);
        if (report && report.scan_time && report.graph && report.summary) {
            const principleSnapshot = await this._hostedPrincipleSnapshot();
            report.principle_count = principleSnapshot.count;
            report.principles = principleSnapshot.entries;
            await this._hostedAnalysisWrite(HOSTED_CONFLICTS_PATH, JSON.stringify(report, null, 2));
            await this._hostedAnalysisWrite(HOSTED_INDEX_PATH, this._hostedAnalysisMarkdown(report));
        }
        if (showNotice) new Notice(t(this, principles.length ? 'hosted_principles_done' : 'hosted_principles_empty', { count: principles.length }), 6000);
        return store.files[file.path];
    }

    _hostedProjectEmbedding(vector, dimensions = 24) {
        const projected = Array(dimensions).fill(0);
        for (let index = 0; index < (vector || []).length; index += 1) {
            const value = Number(vector[index] || 0);
            const sign = ((index * 2654435761) >>> 0) % 2 === 0 ? 1 : -1;
            projected[index % dimensions] += value * sign;
        }
        const norm = Math.sqrt(projected.reduce((total, value) => total + value * value, 0));
        return norm > 0 ? projected.map((value) => value / norm) : projected;
    }

    async _hostedEmbedDocuments(documents) {
        const token = this._hostedAccessToken();
        const vectors = [];
        for (let start = 0; start < documents.length; start += HOSTED_EMBEDDING_BATCH) {
            const batch = documents.slice(start, start + HOSTED_EMBEDDING_BATCH);
            const response = await this._hostedFetch('/v1/embedding', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: batch.map((doc) => `${doc.title}\n${doc.snippet}`) }),
            });
            const rows = response?.result?.embeddings;
            if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error('Hosted embedding response did not match the vault batch.');
            vectors.push(...rows.map((row) => this._hostedProjectEmbedding(row)));
        }
        return vectors;
    }

    _hostedCandidateVectorPairs(vectors) {
        const count = vectors.length;
        const pairs = new Set();
        const add = (left, right) => {
            if (left === right) return;
            const a = Math.min(left, right);
            const b = Math.max(left, right);
            pairs.add(`${a}:${b}`);
        };
        if (count <= 400) {
            for (let left = 0; left < count; left += 1) {
                for (let right = left + 1; right < count; right += 1) add(left, right);
            }
            return pairs;
        }
        const weights = [
            [1, 0.37, -0.19],
            [-0.23, 1, 0.41],
            [0.29, -0.31, 1],
        ];
        for (const weight of weights) {
            const ranked = vectors.map((vector, index) => ({
                index,
                key: (vector[0] || 0) * weight[0] + (vector[1] || 0) * weight[1] + (vector[2] || 0) * weight[2],
            })).sort((a, b) => a.key - b.key);
            for (let position = 0; position < ranked.length; position += 1) {
                for (let offset = 1; offset <= 12 && position + offset < ranked.length; offset += 1) {
                    add(ranked[position].index, ranked[position + offset].index);
                }
            }
        }
        return pairs;
    }

    _hostedTopSemanticPairs(documents, vectors) {
        const top = [];
        const candidates = this._hostedCandidateVectorPairs(vectors);
        for (const key of candidates) {
            const [left, right] = key.split(':').map(Number);
            const score = vectors[left].reduce((total, value, index) => total + value * Number(vectors[right][index] || 0), 0);
            if (score < 0.45) continue;
            const item = { left: documents[left], right: documents[right], similarity: Math.max(-1, Math.min(1, score)) };
            if (top.length < HOSTED_REVIEW_PAIR_LIMIT) {
                top.push(item);
                top.sort((a, b) => b.similarity - a.similarity);
            } else if (item.similarity > top[top.length - 1].similarity) {
                top[top.length - 1] = item;
                top.sort((a, b) => b.similarity - a.similarity);
            }
        }
        return top;
    }

    async _hostedReviewPairs(pairs) {
        if (!pairs.length) return [];
        const response = await this._hostedFetch('/v1/vault/issues/review', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this._hostedAccessToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                consent: 'selected_snippets',
                pairs: pairs.map((pair) => ({
                    left: { path: pair.left.path, title: pair.left.title, snippet: pair.left.snippet },
                    right: { path: pair.right.path, title: pair.right.title, snippet: pair.right.snippet },
                    similarity: pair.similarity,
                })),
            }),
        });
        return Array.isArray(response?.issues) ? response.issues.map((issue) => ({ ...issue, source: 'hosted-review' })) : [];
    }

    async _hostedGraphSummary(documents, edgeKeys) {
        const parent = new Map(documents.map((doc) => [doc.path, doc.path]));
        const find = (value) => {
            let root = value;
            while (parent.get(root) !== root) root = parent.get(root);
            while (parent.get(value) !== value) {
                const next = parent.get(value);
                parent.set(value, root);
                value = next;
            }
            return root;
        };
        const union = (left, right) => {
            if (!parent.has(left) || !parent.has(right)) return;
            const a = find(left);
            const b = find(right);
            if (a !== b) parent.set(b, a);
        };
        const connected = new Set();
        for (const edge of edgeKeys) {
            const [left, right] = edge.split('\u0000');
            union(left, right);
            connected.add(left);
            connected.add(right);
        }
        const components = new Set(documents.map((doc) => find(doc.path)));
        return {
            node_count: documents.length,
            edge_count: edgeKeys.size,
            component_count: components.size,
            connected_node_count: connected.size,
            isolated_node_count: documents.length - connected.size,
        };
    }

    _hostedIssueSummary(issues) {
        const count = (predicate) => issues.filter(predicate).length;
        return {
            total_open: issues.length,
            high: count((issue) => issue.severity === 'high'),
            medium: count((issue) => issue.severity === 'medium'),
            low: count((issue) => issue.severity === 'low'),
            orphan_pages: count((issue) => issue.type === 'orphan_page'),
            dead_links: count((issue) => issue.type === 'dead_link'),
            stale_items: count((issue) => issue.type === 'stale_claim'),
            semantic_items: count((issue) => issue.source === 'hosted-review'),
            auto_fixed: 0,
        };
    }

    async _hostedPrincipleSnapshot() {
        const store = await this._hostedAnalysisReadJson(HOSTED_PRINCIPLES_PATH, { files: {} });
        const entries = [];
        for (const [path, entry] of Object.entries(store.files || {})) {
            for (const principle of entry?.principles || []) {
                entries.push({ path, ...principle });
                if (entries.length >= 500) break;
            }
            if (entries.length >= 500) break;
        }
        return { count: entries.length, entries };
    }

    _hostedAnalysisMarkdown(report) {
        const zh = this.settings?.uiLanguage === 'zh';
        const heading = zh ? 'Understory 分析报告' : 'Understory analysis report';
        const link = (path) => `[[${String(path || '').replace(/\.md$/i, '')}]]`;
        const clean = (value) => String(value || '').replace(/[\r\n|]+/g, ' ').slice(0, 300);
        const lines = [
            `# ${heading}`,
            '',
            `- ${zh ? '扫描时间' : 'Scanned'}: ${report.scan_time}`,
            `- ${zh ? '笔记' : 'Notes'}: ${report.graph.node_count}`,
            `- ${zh ? '关系' : 'Edges'}: ${report.graph.edge_count}`,
            `- ${zh ? '待处理问题' : 'Open issues'}: ${report.summary.total_open}`,
            `- ${zh ? '语义覆盖' : 'Semantic coverage'}: ${report.semantic_coverage.reviewed_notes}/${report.semantic_coverage.eligible_notes}`,
            `- ${zh ? '服务器保存正文' : 'Server content retention'}: 0`,
            '',
            `## ${zh ? '问题' : 'Issues'}`,
            '',
            `| ${zh ? '级别' : 'Severity'} | ${zh ? '类型' : 'Type'} | ${zh ? '笔记' : 'Notes'} | ${zh ? '说明' : 'Details'} |`,
            '| --- | --- | --- | --- |',
        ];
        for (const issue of report.issues.slice(0, 500)) {
            const docs = [issue.doc_a, issue.doc_b, issue.doc].filter(Boolean).map(link).join(' / ') || '-';
            lines.push(`| ${clean(issue.severity)} | ${clean(issue.type)} | ${docs} | ${clean(issue.description)} |`);
        }
        if (!report.issues.length) lines.push(`| - | - | - | ${zh ? '未发现问题' : 'No issues found'} |`);
        lines.push('', `## ${zh ? '知识图谱' : 'Knowledge graph'}`, '');
        lines.push(`- ${zh ? '连通分量' : 'Components'}: ${report.graph.component_count}`);
        lines.push(`- ${zh ? '已连接笔记' : 'Connected notes'}: ${report.graph.connected_node_count}`);
        lines.push(`- ${zh ? '孤立笔记' : 'Isolated notes'}: ${report.graph.isolated_node_count}`);
        lines.push(`- ${zh ? '已提取原则/断言' : 'Extracted principles/claims'}: ${report.principle_count}`);
        lines.push('', `## ${zh ? '原则、断言与决策' : 'Principles, claims, and decisions'}`, '');
        if (report.principles.length) {
            for (const principle of report.principles) {
                lines.push(`- ${link(principle.path)} · **${clean(principle.kind)}** · ${clean(principle.text)}`);
            }
        } else {
            lines.push(zh ? '尚未从笔记中提取明确知识。' : 'No explicit knowledge has been extracted from notes yet.');
        }
        return `${lines.join('\n')}\n`;
    }

    async runHostedVaultAnalysis(manual = true) {
        if (this.settings.lintInProgress) {
            if (manual) new Notice(t(this, 'lint_in_progress_notice'));
            return null;
        }
        if (!this._hostedAccessToken?.()) throw new Error(t(this, 'hosted_login_required'));
        if (!(await this.ensureHostedSnippetConsent(manual))) return null;
        this.settings.lintInProgress = true;
        await this.saveSettings();
        try {
            const state = await this._hostedCollectVaultState();
            const eligible = state.documents.filter((doc) => doc.snippet.length >= 20);
            const semanticDocuments = [...eligible]
                .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
                .slice(0, HOSTED_SEMANTIC_NOTE_LIMIT);
            let semanticIssues = [];
            let semanticStatus = 'complete';
            let reviewedPairs = 0;
            try {
                if (semanticDocuments.length > 1) {
                    const vectors = await this._hostedEmbedDocuments(semanticDocuments);
                    const pairs = this._hostedTopSemanticPairs(semanticDocuments, vectors);
                    reviewedPairs = pairs.length;
                    semanticIssues = await this._hostedReviewPairs(pairs);
                }
            } catch (error) {
                semanticStatus = 'unavailable';
                recordBackgroundError(this, 'review-hosted-vault', error);
            }
            const issues = [...state.issues, ...semanticIssues];
            const severityOrder = { high: 0, medium: 1, low: 2 };
            issues.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));
            const principleSnapshot = await this._hostedPrincipleSnapshot();
            const report = {
                version: 2,
                network_mode: 'hosted',
                corpus_owner: 'obsidian_client',
                server_content_retention: false,
                scan_time: new Date().toISOString(),
                semantic_status: semanticStatus,
                semantic_coverage: {
                    eligible_notes: eligible.length,
                    reviewed_notes: semanticDocuments.length,
                    candidate_pairs_reviewed: reviewedPairs,
                    note_limit: HOSTED_SEMANTIC_NOTE_LIMIT,
                },
                summary: this._hostedIssueSummary(issues),
                graph: await this._hostedGraphSummary(state.documents, state.edgeKeys),
                principle_count: principleSnapshot.count,
                principles: principleSnapshot.entries,
                issues,
            };
            await this._hostedAnalysisWrite(HOSTED_CONFLICTS_PATH, JSON.stringify(report, null, 2));
            await this._hostedAnalysisWrite(HOSTED_INDEX_PATH, this._hostedAnalysisMarkdown(report));
            this.settings.lastLintTime = Date.now();
            await this.saveSettings();
            if (manual) {
                const key = semanticStatus === 'complete' ? 'hosted_analysis_done' : 'hosted_analysis_partial';
                new Notice(t(this, key, { notes: state.documents.length, issues: issues.length }), 8000);
            }
            return report;
        } finally {
            this.settings.lintInProgress = false;
            await this.saveSettings();
        }
    }

    initHostedAnalysis() {
        if ((this.settings?.networkMode || 'hosted') !== 'hosted' || !this.settings?.lintEnabled) return;
        if (this.periodicTimer) return;
        if (!this.settings.lastLintTime) {
            this.settings.lastLintTime = Date.now();
            this.saveSettings();
        }
        this.periodicTimer = window.setInterval(() => {
            if (!this._hostedAccessToken?.() || !this.settings?.hostedConsentAccepted || this.settings?.lintInProgress) return;
            const days = this.settings.lintFrequency === 'monthly' ? 30 : 7;
            if (Date.now() - Number(this.settings.lastLintTime || 0) >= days * 86400000) {
                this.runHostedVaultAnalysis(false).catch((error) => {
                    recordBackgroundError(this, 'scheduled-hosted-vault-analysis', error);
                });
            }
        }, 5 * 60 * 1000);
        this.registerInterval(this.periodicTimer);
    }
}

module.exports = HostedAnalysisMethods.prototype;
module.exports.HOSTED_PRINCIPLES_PATH = HOSTED_PRINCIPLES_PATH;
module.exports.HOSTED_CONFLICTS_PATH = HOSTED_CONFLICTS_PATH;
module.exports.HOSTED_INDEX_PATH = HOSTED_INDEX_PATH;

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
