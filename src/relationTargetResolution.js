/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const path = require('path');

const DEFAULT_INTERNAL_TARGET_PREFIXES = [
    '.understory/',
    '.trash/',
];

const TARGET_STATUSES = ['ok', 'resolved', 'missing', 'ambiguous', 'unsafe'];

function toPosixPath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function hasPathTraversal(relativePath) {
    return relativePath === '..' || relativePath.startsWith('../') || relativePath.includes('/../');
}

function indexKey(value) {
    return String(value || '').trim().toLowerCase();
}

function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function noteTitleFromPath(notePath) {
    const base = toPosixPath(notePath).split('/').filter(Boolean).pop() || notePath || '';
    return base.replace(/\.md$/i, '');
}

function isInternalRelationTarget(target, prefixes = DEFAULT_INTERNAL_TARGET_PREFIXES) {
    const normalized = toPosixPath(target).replace(/^\/+/, '').toLowerCase();
    const firstSegment = normalized.split('/')[0] || '';
    return (firstSegment.startsWith('.') && firstSegment !== '.' && firstSegment !== '..')
        || prefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function normalizeRelationTarget(target, options = {}) {
    if (typeof target !== 'string' || !target.trim()) {
        return { status: 'missing', target: '' };
    }
    const raw = toPosixPath(target.trim());
    if (raw.includes('\0')) {
        return { status: 'unsafe', target: raw };
    }
    if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
        return { status: 'unsafe', target: raw };
    }
    if (hasPathTraversal(raw)) {
        return { status: 'unsafe', target: raw };
    }

    const normalized = path.posix.normalize(raw).replace(/^\/+/, '');
    if (!normalized || normalized === '.' || hasPathTraversal(normalized)) {
        return { status: 'unsafe', target: normalized };
    }
    if (isInternalRelationTarget(normalized, options.internalPrefixes)) {
        return { status: 'unsafe', target: normalized };
    }
    return { status: 'ok', target: normalized };
}

function addIndexValue(map, key, notePath) {
    const normalizedKey = indexKey(key);
    if (!normalizedKey) return;
    const values = map.get(normalizedKey) || [];
    values.push(notePath);
    map.set(normalizedKey, values);
}

function buildVaultPathIndex(notePaths = [], options = {}) {
    const index = {
        pathSet: new Set(),
        byBasename: new Map(),
        byStem: new Map(),
        byTitle: new Map(),
    };
    for (const rawPath of notePaths || []) {
        const normalized = normalizeRelationTarget(rawPath, options);
        if (normalized.status !== 'ok') continue;
        const notePath = normalized.target;
        if (!/\.md$/i.test(notePath)) continue;
        index.pathSet.add(notePath);
        const basename = notePath.split('/').filter(Boolean).pop() || notePath;
        const stem = basename.replace(/\.md$/i, '');
        addIndexValue(index.byBasename, basename, notePath);
        addIndexValue(index.byStem, stem, notePath);
        addIndexValue(index.byTitle, noteTitleFromPath(notePath), notePath);
    }
    for (const map of [index.byBasename, index.byStem, index.byTitle]) {
        for (const [key, values] of map.entries()) {
            map.set(key, uniqueSorted(values));
        }
    }
    return index;
}

function candidateResult(map, key, resolvedReason, ambiguousReason) {
    if (!map) return null;
    const candidates = uniqueSorted(map.get(indexKey(key)) || []);
    if (candidates.length === 1) {
        return {
            targetStatus: 'resolved',
            targetExists: false,
            resolvedTarget: candidates[0],
            resolutionReason: resolvedReason,
        };
    }
    if (candidates.length > 1) {
        return {
            targetStatus: 'ambiguous',
            targetExists: false,
            resolutionReason: ambiguousReason,
            candidates: candidates.slice(0, 5),
        };
    }
    return null;
}

function resolveRelationTarget(relation, pathIndex, options = {}) {
    const index = pathIndex || buildVaultPathIndex();
    const rawTarget = relation && relation.target || '';
    const normalized = normalizeRelationTarget(rawTarget, options);
    if (normalized.status === 'missing') {
        return { targetStatus: 'missing', targetExists: false };
    }
    if (normalized.status === 'unsafe') {
        return { targetStatus: 'unsafe', targetExists: false };
    }

    const target = normalized.target;
    if (index.pathSet && index.pathSet.has(target)) {
        const result = {
            targetStatus: 'ok',
            targetExists: true,
            resolutionReason: 'exact',
        };
        if (target !== rawTarget) result.resolvedTarget = target;
        return result;
    }

    const basename = target.split('/').filter(Boolean).pop() || target;
    const stem = basename.replace(/\.md$/i, '');
    const title = relation && relation.title || '';
    const checks = [
        candidateResult(index.byBasename, basename, 'unique_basename', 'ambiguous_basename'),
        candidateResult(index.byStem, stem, 'unique_stem', 'ambiguous_stem'),
        candidateResult(index.byTitle, title, 'unique_title', 'ambiguous_title'),
    ].filter(Boolean);
    return checks[0] || { targetStatus: 'missing', targetExists: false };
}

function annotateRelations(relations, pathIndex, options = {}) {
    if (!Array.isArray(relations)) return [];
    return relations.map((relation) => ({
        ...relation,
        ...resolveRelationTarget(relation, pathIndex || buildVaultPathIndex(), options),
    }));
}

function relationSummary(relation) {
    const summary = {
        target: relation && relation.target || '',
        title: relation && relation.title || noteTitleFromPath(relation && relation.target || ''),
        type: relation && relation.type || '',
        status: relation && relation.status || 'suggested',
        score: relation && relation.score,
        targetStatus: relation && relation.targetStatus || 'missing',
        targetExists: Boolean(relation && relation.targetExists),
    };
    if (relation && relation.resolvedTarget) summary.resolvedTarget = relation.resolvedTarget;
    if (relation && relation.resolutionReason) summary.resolutionReason = relation.resolutionReason;
    if (relation && Array.isArray(relation.candidates) && relation.candidates.length) {
        summary.candidates = relation.candidates.slice(0, 5);
    }
    return summary;
}

function relationDiagnostic(relation) {
    const diagnostic = {
        target: relation && relation.target || '',
        title: relation && relation.title || noteTitleFromPath(relation && relation.target || ''),
        targetStatus: relation && relation.targetStatus || 'missing',
        targetExists: Boolean(relation && relation.targetExists),
    };
    if (relation && relation.resolvedTarget) diagnostic.resolvedTarget = relation.resolvedTarget;
    if (relation && relation.resolutionReason) diagnostic.resolutionReason = relation.resolutionReason;
    if (relation && Array.isArray(relation.candidates) && relation.candidates.length) {
        diagnostic.candidates = relation.candidates.slice(0, 5);
    }
    return diagnostic;
}

function buildRelationDiagnostics(relations) {
    const relationTargets = Object.fromEntries(TARGET_STATUSES.map((status) => [status, 0]));
    const resolvedRelations = [];
    const unresolvedRelations = [];
    for (const relation of relations || []) {
        const status = TARGET_STATUSES.includes(relation && relation.targetStatus) ? relation.targetStatus : 'missing';
        relationTargets[status] += 1;
        if (status === 'resolved') {
            resolvedRelations.push(relationDiagnostic(relation));
        } else if (status === 'missing' || status === 'ambiguous' || status === 'unsafe') {
            unresolvedRelations.push(relationDiagnostic(relation));
        }
    }
    return {
        relationTargets,
        resolvedRelations,
        unresolvedRelations,
    };
}

function relationTargetForRead(relation) {
    if (!relation) return '';
    if (relation.targetStatus === 'resolved' && relation.resolvedTarget) return relation.resolvedTarget;
    if (relation.targetStatus === 'ok') return relation.resolvedTarget || relation.target || '';
    return '';
}

module.exports = {
    DEFAULT_INTERNAL_TARGET_PREFIXES,
    TARGET_STATUSES,
    annotateRelations,
    buildRelationDiagnostics,
    buildVaultPathIndex,
    relationSummary,
    relationTargetForRead,
    resolveRelationTarget,
};

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
