/**
 * Ingest normalisers for the analytics sub-documents sent by the extension.
 *
 * Deliberately dependency-free (no express, no mongoose) so they can be unit
 * tested without installing or booting the server.
 *
 * Every normaliser must tolerate a payload from an older extension version
 * that omits its sub-document entirely (older extensions send fewer fields).
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

// Payload v3 signals (extension 2.6.0, plan E7–E11): counts and yes/no flags only.
const MAX_SIGNAL_COUNT = 10000; // per upload; a real interval has a handful
const RUN_KEYS = ['terminal', 'task', 'debugNoDebug', 'codeRunner'];
const DEBUG_KEYS = ['sessions', 'breakpointStops', 'steps'];
// reading.docFileSec is sent but not stored: it can be worked out from fileTime.
const READING_KEYS = ['scrollEvents', 'navigations', 'filesOpenedNotEdited'];
const SIZE_BUCKETS = ['0', '1', '2-5', '6-20', '21-100', '101-500', '500+'];
const WORKSPACE_FLAGS = ['hasPackageJson', 'hasRequirements', 'hasGit', 'clonedRecently'];
const SIGNAL_BLOCKS = ['runs', 'debug', 'reading', 'filesCreated', 'filesDeleted', 'workspace'];

const count = (v) => Math.min(MAX_SIGNAL_COUNT, Math.floor(num(v)));

function counts(source, keys) {
    const s = source && typeof source === 'object' ? source : {};
    const out = {};
    for (const k of keys) out[k] = count(s[k]);
    return out;
}

function normalizeWorkspace(w) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
    const out = {};
    if (SIZE_BUCKETS.includes(w.sourceFilesBucket)) out.sourceFilesBucket = w.sourceFilesBucket;
    for (const k of WORKSPACE_FLAGS) out[k] = w[k] === true;
    out.ownCommits = typeof w.ownCommits === 'boolean' ? w.ownCommits : null;
    return out;
}

/**
 * What ran, real debugging, reading signals, file events and the kind of project.
 * Returns null for uploads from extensions before 2.6.0, which send none of these blocks.
 */
function normalizeV3Signals(body) {
    const b = body && typeof body === 'object' ? body : {};
    if (!SIGNAL_BLOCKS.some((k) => b[k] !== undefined && b[k] !== null)) return null;
    return {
        runs: counts(b.runs, RUN_KEYS),
        debug: counts(b.debug, DEBUG_KEYS),
        reading: counts(b.reading, READING_KEYS),
        filesCreated: count(b.filesCreated),
        filesDeleted: count(b.filesDeleted),
        workspace: normalizeWorkspace(b.workspace),
    };
}

// Plan E12 / B4: what the user said they were doing (status-bar picker in extension 2.6.0).
const WORK_MODES = ['auto', 'dsa', 'project', 'debugging', 'learning', 'setup'];

/**
 * { mode, confirmed } or null. An unknown mode is dropped, not refused: the upload's time is
 * still real. confirmed is true only when the user picked or confirmed it in that coding session
 * (the extension decides); 'auto' is never confirmed, because it is not an answer.
 */
function normalizeUserMode(body) {
    const u = body && body.userMode;
    if (!u || typeof u !== 'object' || !WORK_MODES.includes(u.mode)) return null;
    return { mode: u.mode, confirmed: u.mode !== 'auto' && u.confirmed === true };
}

module.exports = {
    normalizeEditorAnalytics,
    normalizeFocusAnalytics,
    normalizeGitAnalytics,
    normalizeV3Signals,
    normalizeUserMode,
    WORK_MODES,
    MAX_FLOW_BLOCKS,
    RUN_KEYS, DEBUG_KEYS, READING_KEYS, SIZE_BUCKETS,
};
