/**
 * Activity bucketing — pure helpers for merging flush payloads into
 * 10-minute rollup documents. Dependency-free (no mongoose, no express) so it
 * unit-tests without a database, mirroring services/activityNormalizers.js.
 *
 * Correctness invariant: $inc.duration is the REAL measured active-coding
 * seconds from the flush. Nothing here ever writes the bucket width.
 */

const BUCKET_MS = 600000; // 10 minutes

// Additive editor leaves. `uniqueFiles` is a set-size, not additive — the
// `files` array replaces it on read.
const EDITOR_INC = [
  'charsInserted', 'charsDeleted', 'linesInserted', 'linesDeleted', 'churnLines',
  'undoCount', 'redoCount', 'saveCount', 'fileSwitches', 'readMs', 'writeMs',
  'largeInsertCount', 'largeInsertChars',
];
const FOCUS_INC = ['focusedMs', 'blurredMs', 'blurEvents'];
const GIT_INC = ['commits', 'filesChanged']; // uncommitted* are point-in-time gauges — skip
const TERMINAL_INC = [
  'totalCommands', 'terminalErrorCount', 'successfulCommands', 'failedCommands',
  'buildRuns', 'testRuns', 'successfulBuilds', 'failedBuilds', 'debuggingSessions',
];
const COMMAND_USAGE_KEYS = ['git', 'npm', 'node', 'python', 'docker', 'gcc', 'java', 'pip', 'misc'];
const GIT_ACTIVITY_KEYS = ['commits', 'pushes', 'pulls', 'checkouts', 'merges', 'clones'];
const DEEP_BLOCK_MS = 25 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 10-minute-floored Date. Accepts a Date or epoch ms; NaN -> now. */
function bucketStartFor(when, bucketMs = BUCKET_MS) {
  const t = when instanceof Date ? when.getTime() : Number(when);
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(Math.floor(base / bucketMs) * bucketMs);
}

/** True if this flush carries any real coding signal. */
function hasSignal(p) {
  const e = (p && p.editorAnalytics) || {};
  const t = (p && p.terminalAnalytics) || {};
  const g = (p && p.gitAnalytics) || {};
  const f = (p && p.focusAnalytics) || {};
  return (
    num(e.charsInserted) > 0 || num(e.charsDeleted) > 0 || num(e.saveCount) > 0 ||
    num(e.linesInserted) > 0 || num(e.linesDeleted) > 0 ||
    num(t.totalCommands) > 0 || num(g.commits) > 0 ||
    (Array.isArray(f.flowBlocksMs) && f.flowBlocksMs.length > 0)
  );
}

function bucketFilter(userId, projectName, language, bucketStart) {
  return { userId, projectName, language, bucketStart };
}

function addInc(inc, prefix, src, keys) {
  if (!src) return;
  for (const k of keys) {
    const v = num(src[k]);
    if (v > 0) inc[`${prefix}.${k}`] = (inc[`${prefix}.${k}`] || 0) + v;
  }
}

/** Build the update doc (no $setOnInsert — the caller adds that). */
function buildBucketUpdate(p, fileName, fileType) { // eslint-disable-line no-unused-vars
  const e = (p && p.editorAnalytics) || {};
  const f = (p && p.focusAnalytics) || {};
  const t = (p && p.terminalAnalytics) || {};

  const inc = {
    duration: num(p && p.duration),
    linesAdded: num(p && p.linesAdded),
    linesRemoved: num(p && p.linesRemoved),
    flushCount: 1,
  };
  addInc(inc, 'editorAnalytics', e, EDITOR_INC);
  addInc(inc, 'focusAnalytics', f, FOCUS_INC);
  addInc(inc, 'gitAnalytics', (p && p.gitAnalytics) || {}, GIT_INC);
  addInc(inc, 'terminalAnalytics', t, TERMINAL_INC);
  addInc(inc, 'terminalAnalytics.commandUsage', t.commandUsage || {}, COMMAND_USAGE_KEYS);
  addInc(inc, 'terminalAnalytics.gitActivity', t.gitActivity || {}, GIT_ACTIVITY_KEYS);

  const update = { $inc: inc };

  const longest = num(f.longestBlockMs);
  if (longest > 0) update.$max = { 'focusAnalytics.longestBlockMs': longest };

  const blocks = Array.isArray(f.flowBlocksMs)
    ? f.flowBlocksMs.map(num).filter((n) => n > 0)
    : [];
  if (blocks.length) {
    update.$push = { 'focusAnalytics.flowBlocksMs': { $each: blocks, $slice: -200 } };
  }

  if (fileName && fileName !== 'unknown') {
    update.$addToSet = { files: fileName };
  }

  const set = {};
  if (t.lastCommand && t.lastCommand !== 'unknown') set['terminalAnalytics.lastCommand'] = t.lastCommand;
  if (t.lastCommandTimestamp) set['terminalAnalytics.lastCommandTimestamp'] = t.lastCommandTimestamp;
  if (Array.isArray(t.repeatedFailedCommands) && t.repeatedFailedCommands.length) {
    set['terminalAnalytics.repeatedFailedCommands'] = t.repeatedFailedCommands;
  }
  if (Object.keys(set).length) update.$set = set;

  return update;
}

/**
 * Decide how to persist a flush.
 *   { mode: 'legacy' }  -> caller does Activity.create(fullDoc)  (ACTIVITY_BUCKET_MS=0)
 *   { mode: 'merge', filter, inc }  -> updateOne(filter, { $inc: inc }, { upsert: false })
 *   { mode: 'bucket', filter, update, setOnInsert, bucketStart }
 *       -> findOneAndUpdate(filter, { ...update, $setOnInsert: setOnInsert },
 *                           { upsert: true, new: true, setDefaultsOnInsert: false })
 */
function planActivityWrite(normalized, when, bucketMs = BUCKET_MS) {
  if (!bucketMs) return { mode: 'legacy' };
  const bucketStart = bucketStartFor(when, bucketMs);
  const filter = bucketFilter(
    normalized.userId, normalized.projectName, normalized.language, bucketStart,
  );
  if (!hasSignal(normalized)) {
    return { mode: 'merge', filter, inc: { duration: num(normalized.duration), flushCount: 1 } };
  }
  const update = buildBucketUpdate(normalized, normalized.fileName, normalized.fileType);
  const setOnInsert = {
    userId: normalized.userId,
    projectName: normalized.projectName,
    language: normalized.language,
    fileType: normalized.fileType || 'unknown',
    bucketStart,
    timestamp: bucketStart,
  };
  return { mode: 'bucket', filter, update, setOnInsert, bucketStart };
}

module.exports = {
  BUCKET_MS, DEEP_BLOCK_MS,
  EDITOR_INC, TERMINAL_INC, FOCUS_INC, GIT_INC,
  bucketStartFor, hasSignal, bucketFilter, buildBucketUpdate, planActivityWrite,
};
