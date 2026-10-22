/**
 * Activity bucketing — pure helpers for merging flush payloads into
 * 10-minute rollup documents. Dependency-free (no mongoose, no express) so it
 * unit-tests without a database, mirroring services/activityNormalizers.js.
 *
 * Correctness invariant: $inc.duration is the REAL measured active-coding
 * seconds from the flush. Nothing here ever writes the bucket width.
 */

const { timeInc } = require('./timeParts');

const { RUN_KEYS, DEBUG_KEYS, READING_KEYS } = require('./activityNormalizers');
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
// Must match services/commandKinds.js COMMAND_KINDS (asserted in tests/activityBucket.test.js).
const COMMAND_KIND_KEYS = ['install', 'run', 'compile', 'build', 'test', 'git', 'docker', 'other'];
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

/** Sum of the v3 counters (runs, debugging, reading, file events); 0 for older payloads. */
function signalCount(s) {
  if (!s) return 0;
  const sum = (o) => Object.values(o || {}).reduce((a, v) => a + num(v), 0);
  return sum(s.runs) + sum(s.debug) + sum(s.reading) + num(s.filesCreated) + num(s.filesDeleted);
}

/**
 * Seconds of a window that the user said were a given kind of work (plan B4). Only a CONFIRMED
 * answer counts, and only a real mode (not 'auto'). Summed per mode, so a session's label can later
 * be the mode confirmed for most of its time.
 */
function modeInc(userMode, seconds) {
  const s = num(seconds);
  if (!userMode || !userMode.confirmed || userMode.mode === 'auto' || s <= 0) return {};
  return { [`modeSec.${userMode.mode}`]: s };
}

/** True if this flush carries any real coding signal. */
function hasSignal(p) {
  const e = (p && p.editorAnalytics) || {};
  const t = (p && p.terminalAnalytics) || {};
  const g = (p && p.gitAnalytics) || {};
  const f = (p && p.focusAnalytics) || {};
  const k = (p && p.timeParts && p.timeParts.kinds) || {};
  return (
    // Payload v3: any counted time is signal (reading-only and running-only work are real).
    num(k.writingSec) > 0 || num(k.readingSec) > 0 || num(k.runningSec) > 0 ||
    num(e.charsInserted) > 0 || num(e.charsDeleted) > 0 || num(e.saveCount) > 0 ||
    num(e.linesInserted) > 0 || num(e.linesDeleted) > 0 ||
    num(t.totalCommands) > 0 || num(g.commits) > 0 || signalCount(p && p.signals) > 0 ||
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
    const key = prefix ? `${prefix}.${k}` : k;
    if (v > 0) inc[key] = (inc[key] || 0) + v;
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
  const kinds = t.commandKinds || {};
  addInc(inc, 'terminalAnalytics.commandKinds', kinds, COMMAND_KIND_KEYS);
  addInc(inc, 'terminalAnalytics.commandKinds.failed', kinds.failed || {}, COMMAND_KIND_KEYS);
  // Extension 2.6.0 signals. buildBucketUpdate only runs for the upload's first window, so
  // these counters are never repeated in the windows a long upload is spread over.
  const sig = (p && p.signals) || null;
  if (sig) {
    addInc(inc, 'runs', sig.runs, RUN_KEYS);
    addInc(inc, 'debug', sig.debug, DEBUG_KEYS);
    addInc(inc, 'reading', sig.reading, READING_KEYS);
    addInc(inc, '', { filesCreated: sig.filesCreated, filesDeleted: sig.filesDeleted }, ['filesCreated', 'filesDeleted']);
  }

  const update = { $inc: inc };

  const longest = num(f.longestBlockMs);
  if (longest > 0) update.$max = { 'focusAnalytics.longestBlockMs': longest };

  const blocks = Array.isArray(f.flowBlocksMs)
    ? f.flowBlocksMs.map(num).filter((n) => n > 0)
    : [];
  if (blocks.length) {
    update.$push = { 'focusAnalytics.flowBlocksMs': { $each: blocks, $slice: -200 } };
  }

  // Payload v3: this window's share of writing / reading / running and per-file time.
  const parts = timeInc(p && p.timeWindow);
  Object.assign(inc, parts.$inc);
  const names = [...new Set([fileName, ...parts.files].filter((n) => n && n !== 'unknown'))];
  if (names.length) {
    update.$addToSet = { files: names.length === 1 ? names[0] : { $each: names } };
  }

  const set = { ...parts.$set };
  if (t.lastCommand && t.lastCommand !== 'unknown') set['terminalAnalytics.lastCommand'] = t.lastCommand;
  if (t.lastCommandTimestamp) set['terminalAnalytics.lastCommandTimestamp'] = t.lastCommandTimestamp;
  if (Array.isArray(t.repeatedFailedCommands) && t.repeatedFailedCommands.length) {
    set['terminalAnalytics.repeatedFailedCommands'] = t.repeatedFailedCommands;
  }
  // What the user said they were doing: the latest answer, and confirmed seconds per mode.
  const um = p && p.userMode;
  if (um) {
    set['userMode.mode'] = um.mode;
    set['userMode.confirmed'] = um.confirmed;
    Object.assign(inc, modeInc(um, p.duration));
  }
  // The project's kind: latest upload wins; an unknown value (null) never overwrites a known one.
  if (sig && sig.workspace) {
    for (const [k, v] of Object.entries(sig.workspace)) {
      if (v !== null && v !== undefined) set[`workspace.${k}`] = v;
    }
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
  EDITOR_INC, TERMINAL_INC, FOCUS_INC, GIT_INC, COMMAND_KIND_KEYS,
  bucketStartFor, hasSignal, signalCount, modeInc, bucketFilter, buildBucketUpdate, planActivityWrite,
};
