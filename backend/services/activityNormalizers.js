/**
 * Ingest normalisers for the analytics sub-documents sent by the extension.
 *
 * Deliberately dependency-free (no express, no mongoose) so they can be unit
 * tested without installing or booting the server.
 *
 * Every normaliser must tolerate a payload from an older extension version
 * that omits its sub-document entirely — see docs/TRACKING_ROADMAP.md.
 */

const MAX_FLOW_BLOCKS = 200;

/** Non-negative finite number, else 0. */
function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

const EDITOR_FIELDS = [
    'charsInserted', 'charsDeleted', 'linesInserted', 'linesDeleted',
    'churnLines', 'undoCount', 'redoCount', 'saveCount',
    'fileSwitches', 'uniqueFiles', 'readMs', 'writeMs',
    'largeInsertCount', 'largeInsertChars'
];

function normalizeEditorAnalytics(body) {
    const source = (body && body.editorAnalytics) || {};
    const result = {};
    for (const field of EDITOR_FIELDS) result[field] = num(source[field]);
    return result;
}

function normalizeFocusAnalytics(body) {
    const source = (body && body.focusAnalytics) || {};
    const blocks = Array.isArray(source.flowBlocksMs) ? source.flowBlocksMs : [];
    const flowBlocksMs = blocks
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, MAX_FLOW_BLOCKS);

    return {
        focusedMs: num(source.focusedMs),
        blurredMs: num(source.blurredMs),
        blurEvents: num(source.blurEvents),
        flowBlocksMs,
        longestBlockMs: num(source.longestBlockMs)
    };
}

function normalizeGitAnalytics(body) {
    const source = (body && body.gitAnalytics) || {};
    return {
        commits: num(source.commits),
        filesChanged: num(source.filesChanged),
        uncommittedFiles: num(source.uncommittedFiles),
        uncommittedAgeMs: num(source.uncommittedAgeMs)
    };
}

module.exports = {
    normalizeEditorAnalytics,
    normalizeFocusAnalytics,
    normalizeGitAnalytics,
    MAX_FLOW_BLOCKS
};
